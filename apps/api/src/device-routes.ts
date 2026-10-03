import type { DeviceRelay, DeviceSink } from "@cadre/adapters";
import { DeviceCapabilitiesSchema, DevicePlatformSchema } from "@cadre/contracts";
import type { PrismaClient } from "@cadre/db";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readBoundedBody } from "./http-body.js";

export const DEVICE_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;
export const DEVICE_KEEPALIVE_MS = 15_000;

const DeviceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);
const RegisterBody = z.object({
  deviceId: DeviceId,
  name: z.string().trim().min(1).max(120),
  platform: DevicePlatformSchema,
  version: z.string().trim().min(1).max(64),
  capabilities: DeviceCapabilitiesSchema.loose(),
});
const ResponseBody = z.union([
  z.object({ id: z.string().min(1), ok: z.literal(true), result: z.unknown().optional() }),
  z.object({
    id: z.string().min(1),
    ok: z.literal(false),
    error: z.object({ name: z.string().optional(), message: z.string() }),
  }),
]);

export interface DeviceRouteDeps {
  prisma: PrismaClient;
  relay: DeviceRelay;
  /** Session (bearer or cookie) and trusted origin check. Null means unauthorized. */
  authenticate(c: Context): Promise<{ userId: string } | null>;
  keepaliveMs?: number;
}

/** The relay endpoints a Burst device speaks to. Only the owning user may use a device. */
export function mountDeviceRoutes(app: Hono, deps: DeviceRouteDeps) {
  const { prisma, relay } = deps;
  const keepaliveMs = deps.keepaliveMs ?? DEVICE_KEEPALIVE_MS;
  const unauthorized = (c: Context) => c.json({ error: "Unauthorized" }, 401);
  const notFound = (c: Context) => c.json({ error: "Device not found" }, 404);
  const touch = (deviceId: string) =>
    prisma.device
      .updateMany({ where: { id: deviceId, revokedAt: null }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  const owned = (deviceId: string, userId: string) =>
    prisma.device.findFirst({
      where: { id: deviceId, userId, revokedAt: null },
      select: { id: true },
    });

  app.post("/api/devices/register", async (c) => {
    const auth = await deps.authenticate(c);
    if (!auth) return unauthorized(c);
    const body = await readBoundedBody(c.req.raw, 64 * 1024);
    const parsed = RegisterBody.safeParse(safeJson(body));
    if (!parsed.success) return c.json({ error: "Invalid device" }, 400);
    const { deviceId, name, platform, version, capabilities } = parsed.data;
    const existing = await prisma.device.findUnique({
      where: { id: deviceId },
      select: { userId: true },
    });
    if (existing && existing.userId !== auth.userId) return c.json({ error: "Forbidden" }, 403);
    const row = await prisma.device.upsert({
      where: { id: deviceId },
      create: {
        id: deviceId,
        userId: auth.userId,
        name,
        platform,
        version,
        capabilities: capabilities as never,
      },
      update: {
        name,
        platform,
        version,
        capabilities: capabilities as never,
        revokedAt: null,
        lastSeenAt: new Date(),
      },
      select: { id: true, name: true, createdAt: true },
    });
    return c.json({ deviceId: row.id, name: row.name, createdAt: row.createdAt.toISOString() });
  });

  app.get("/api/devices/:deviceId/requests", async (c) => {
    const auth = await deps.authenticate(c);
    if (!auth) return unauthorized(c);
    const deviceId = c.req.param("deviceId");
    if (!(await owned(deviceId, auth.userId))) return notFound(c);
    const encoder = new TextEncoder();
    let cleanup = async () => {};
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const write = (text: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            open = false;
          }
        };
        const end = () => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        };
        const sink: DeviceSink = {
          send: (message) => write(`event: request\ndata: ${JSON.stringify(message)}\n\n`),
          close: (reason) => {
            if (reason === "replaced") write("event: replaced\ndata: {}\n\n");
            end();
          },
        };
        write(": connected\n\n");
        const detach = await relay.attach(deviceId, sink);
        await touch(deviceId);
        const timer = setInterval(() => {
          write(": keepalive\n\n");
          void touch(deviceId);
        }, keepaliveMs);
        timer.unref?.();
        cleanup = async () => {
          clearInterval(timer);
          end();
          await detach();
        };
        if (c.req.raw.signal.aborted) await cleanup();
        else c.req.raw.signal.addEventListener("abort", () => void cleanup(), { once: true });
      },
      cancel() {
        return cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  app.post("/api/devices/:deviceId/responses", async (c) => {
    const auth = await deps.authenticate(c);
    if (!auth) return unauthorized(c);
    const deviceId = c.req.param("deviceId");
    if (!(await owned(deviceId, auth.userId))) return notFound(c);
    const body = await readBoundedBody(c.req.raw, DEVICE_RESPONSE_MAX_BYTES);
    if (body === null) return c.json({ error: "Response too large" }, 413);
    const parsed = ResponseBody.safeParse(safeJson(body));
    if (!parsed.success) return c.json({ error: "Invalid response" }, 400);
    // Only ids the server issued to this device are accepted.
    if (!(await relay.respond(deviceId, parsed.data as Parameters<DeviceRelay["respond"]>[1])))
      return c.json({ error: "Unknown request" }, 404);
    return c.body(null, 204);
  });

  app.post("/api/devices/:deviceId/heartbeat", async (c) => {
    const auth = await deps.authenticate(c);
    if (!auth) return unauthorized(c);
    const deviceId = c.req.param("deviceId");
    if (!(await owned(deviceId, auth.userId))) return notFound(c);
    await touch(deviceId);
    return c.json({ ok: true });
  });

  app.delete("/api/devices/:deviceId", async (c) => {
    const auth = await deps.authenticate(c);
    if (!auth) return unauthorized(c);
    const deviceId = c.req.param("deviceId");
    // Bots assigned to the device fall back to the default computer (SetNull); pending rows cascade.
    const removed = await prisma.device.deleteMany({
      where: { id: deviceId, userId: auth.userId },
    });
    if (removed.count === 0) return notFound(c);
    await relay.revoke(deviceId);
    return c.json({ ok: true });
  });
}

function safeJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
