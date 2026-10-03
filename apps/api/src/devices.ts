import type { Actor, Bot, Device, DeviceCapabilities } from "@cadre/contracts";
import { ACTIVE_RUN_STATUSES } from "@cadre/core";
import { createRepos, type PrismaClient } from "@cadre/db";
import { ORPCError } from "@orpc/server";

/** How the API process knows which devices hold an open request stream. */
export interface DevicePresence {
  isOnline(deviceId: string): boolean | Promise<boolean>;
  /** Fail pending requests and close the stream of a removed device. */
  disconnect?(deviceId: string): void | Promise<void>;
}

/** Without a relay, a device counts as online when it was seen within two keepalive windows. */
const ONLINE_WINDOW_MS = 45_000;

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  version: string;
  capabilities: unknown;
  lastSeenAt: Date | null;
}

export async function deviceDto(row: DeviceRow, presence?: DevicePresence): Promise<Device> {
  const online = presence
    ? await presence.isOnline(row.id)
    : Boolean(row.lastSeenAt && Date.now() - row.lastSeenAt.getTime() < ONLINE_WINDOW_MS);
  return {
    id: row.id,
    name: row.name,
    platform: row.platform === "linux" ? "linux" : "macos",
    version: row.version,
    online,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    capabilities: (row.capabilities && typeof row.capabilities === "object"
      ? row.capabilities
      : {}) as DeviceCapabilities,
  };
}

export function createDevicesService(prisma: PrismaClient, presence?: DevicePresence) {
  const repos = createRepos(prisma);

  async function owned(actor: Actor, deviceId: string) {
    const row = await prisma.device.findFirst({
      where: { id: deviceId, userId: actor.userId, revokedAt: null },
    });
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Device not found" });
    return row;
  }

  return {
    async list(actor: Actor): Promise<Device[]> {
      const rows = await prisma.device.findMany({
        where: { userId: actor.userId, revokedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
      return Promise.all(rows.map((row) => deviceDto(row, presence)));
    },

    async rename(actor: Actor, input: { deviceId: string; name: string }): Promise<Device> {
      await owned(actor, input.deviceId);
      const row = await prisma.device.update({
        where: { id: input.deviceId },
        data: { name: input.name },
      });
      return deviceDto(row, presence);
    },

    async remove(actor: Actor, input: { deviceId: string }): Promise<{ ok: true }> {
      await owned(actor, input.deviceId);
      // Bots using the device fall back to the default computer (onDelete: SetNull).
      await prisma.device.delete({ where: { id: input.deviceId } });
      await presence?.disconnect?.(input.deviceId);
      return { ok: true };
    },

    async assign(actor: Actor, input: { botId: string; deviceId: string | null }): Promise<Bot> {
      const bot = await repos.getBot(actor, input.botId);
      if (input.deviceId !== null) await owned(actor, input.deviceId);
      if ((bot.deviceId ?? null) === input.deviceId) {
        return repos.setBotDevice(actor, bot.id, input.deviceId);
      }
      const active = await prisma.run.findFirst({
        where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        select: { id: true },
      });
      if (active) throw new ORPCError("BAD_REQUEST", { message: "Stop the bot first" });
      return repos.setBotDevice(actor, bot.id, input.deviceId);
    },
  };
}
