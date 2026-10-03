import type { Actor } from "@cadre/contracts";
import type { PrismaClient } from "@cadre/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@example.test",
  isDeploymentOwner: false,
};

const seen = new Date("2026-09-20T10:00:00.000Z");
const device = {
  id: "device-1",
  userId: "user-1",
  name: "Studio Mac",
  platform: "macos",
  version: "1.0.0",
  capabilities: { accessibility: true },
  lastSeenAt: seen,
  revokedAt: null,
};

function setup(overrides: { devices?: unknown[]; activeRun?: boolean; online?: boolean } = {}) {
  const rows = overrides.devices ?? [device];
  const prisma = {
    device: {
      findMany: vi.fn(async ({ where }) =>
        rows.filter((row) => (row as { userId: string }).userId === where.userId),
      ),
      findFirst: vi.fn(
        async ({ where }) =>
          rows.find(
            (row) =>
              (row as { id: string }).id === where.id &&
              (row as { userId: string }).userId === where.userId,
          ) ?? null,
      ),
      update: vi.fn(async ({ data }) => ({ ...device, ...data })),
      delete: vi.fn(async () => device),
    },
    bot: {
      findFirst: vi.fn(async ({ where }) =>
        where.id === "bot-1" && where.spaceId === "space-1" && where.userId === "user-1"
          ? {
              id: "bot-1",
              spaceId: "space-1",
              deviceId: null,
              thread: { id: "thread-1", unread: false },
              computer: { scope: "team" },
            }
          : null,
      ),
      update: vi.fn(async ({ data }) => ({
        id: "bot-1",
        spaceId: "space-1",
        name: "Bot",
        title: "",
        description: "",
        instructions: "",
        color: "#000000",
        notifyOnFinish: false,
        pinned: false,
        sectionId: null,
        archivedAt: null,
        parentBotId: null,
        memoryScope: null,
        createdAt: seen,
        updatedAt: seen,
        thread: { id: "thread-1", unread: false },
        computer: { scope: "team" },
        deviceId: data.deviceId,
      })),
    },
    run: { findFirst: vi.fn(async () => (overrides.activeRun ? { id: "run-1" } : null)) },
  } as unknown as PrismaClient;
  const disconnect = vi.fn();
  const deps = {
    prisma,
    devices: { isOnline: () => overrides.online ?? true, disconnect },
    env: { sandboxProvider: "device" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(path: string, body: unknown, as: Actor | null = actor) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor: as } },
    );
    return response;
  }
  return { prisma, call, disconnect };
}

describe("devices procedures", () => {
  it("lists only the caller's devices with online state", async () => {
    const other = { ...device, id: "device-2", userId: "user-2" };
    const { call } = setup({ devices: [device, other], online: false });
    const response = await call("devices/list", undefined);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { json: unknown[] };
    expect(body.json).toEqual([
      {
        id: "device-1",
        name: "Studio Mac",
        platform: "macos",
        version: "1.0.0",
        online: false,
        lastSeenAt: seen.toISOString(),
        capabilities: { accessibility: true },
      },
    ]);
  });

  it("requires a signed-in actor", async () => {
    const { call } = setup();
    expect((await call("devices/list", undefined, null)).status).toBe(401);
  });

  it("renames an owned device and refuses someone else's", async () => {
    const { call, prisma } = setup({
      devices: [device, { ...device, id: "device-2", userId: "user-2" }],
    });
    const ok = await call("devices/rename", { deviceId: "device-1", name: "  Desk  " });
    expect(ok.status).toBe(200);
    expect(prisma.device.update).toHaveBeenCalledWith({
      where: { id: "device-1" },
      data: { name: "Desk" },
    });
    const denied = await call("devices/rename", { deviceId: "device-2", name: "Mine" });
    expect(denied.status).toBe(404);
  });

  it("removes an owned device and disconnects it", async () => {
    const { call, prisma, disconnect } = setup();
    expect((await call("devices/remove", { deviceId: "device-1" })).status).toBe(200);
    expect(prisma.device.delete).toHaveBeenCalledWith({ where: { id: "device-1" } });
    expect(disconnect).toHaveBeenCalledWith("device-1");
    const denied = setup({ devices: [] });
    expect((await denied.call("devices/remove", { deviceId: "device-1" })).status).toBe(404);
    expect(denied.prisma.device.delete).not.toHaveBeenCalled();
  });

  it("assigns and unassigns a device for the owner's bot", async () => {
    const { call, prisma } = setup();
    const assigned = await call("devices/assign", { botId: "bot-1", deviceId: "device-1" });
    expect(assigned.status).toBe(200);
    expect(((await assigned.json()) as { json: { deviceId: string } }).json.deviceId).toBe(
      "device-1",
    );
    expect(prisma.bot.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot-1" }, data: { deviceId: "device-1" } }),
    );
    const cleared = await call("devices/assign", { botId: "bot-1", deviceId: null });
    expect(cleared.status).toBe(200);
  });

  it("refuses another user's device, another space's bot, and a running bot", async () => {
    const foreign = setup({ devices: [{ ...device, userId: "user-2" }] });
    expect(
      (await foreign.call("devices/assign", { botId: "bot-1", deviceId: "device-1" })).status,
    ).toBe(404);
    expect(foreign.prisma.bot.update).not.toHaveBeenCalled();

    const { call, prisma } = setup();
    const wrongBot = await call("devices/assign", { botId: "bot-9", deviceId: "device-1" });
    expect(wrongBot.status).toBeGreaterThanOrEqual(400);
    expect(prisma.bot.update).not.toHaveBeenCalled();

    const busy = setup({ activeRun: true });
    expect(
      (await busy.call("devices/assign", { botId: "bot-1", deviceId: "device-1" })).status,
    ).toBe(400);
    expect(busy.prisma.bot.update).not.toHaveBeenCalled();
  });
});
