import { MemoryDeviceRelay } from "@cadre/adapters";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountDeviceRoutes } from "./device-routes.js";

const ID = "11111111-2222-3333-4444-555555555555";

function setup() {
  const devices = new Map<string, any>();
  const prisma: any = {
    device: {
      findUnique: async ({ where }: any) => devices.get(where.id) ?? null,
      findFirst: async ({ where }: any) => {
        const row = devices.get(where.id);
        return row && row.userId === where.userId && !row.revokedAt ? row : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const row = devices.get(where.id);
        const next = row
          ? { ...row, ...update }
          : {
              ...create,
              createdAt: new Date("2026-01-01"),
              lastSeenAt: new Date(0),
              revokedAt: null,
            };
        devices.set(where.id, next);
        return next;
      },
      updateMany: async ({ where, data }: any) => {
        const row = devices.get(where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
      deleteMany: async ({ where }: any) => {
        const row = devices.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        devices.delete(where.id);
        return { count: 1 };
      },
    },
  };
  const relay = new MemoryDeviceRelay();
  const app = new Hono();
  mountDeviceRoutes(app, {
    prisma,
    relay,
    keepaliveMs: 10,
    authenticate: async (c) => {
      const user = c.req.header("x-user");
      return user ? { userId: user } : null;
    },
  });
  const request = (path: string, init: RequestInit & { user?: string } = {}) =>
    app.request(path, {
      ...init,
      headers: { ...(init.user ? { "x-user": init.user } : {}), ...(init.headers as object) },
    });
  const register = (user = "u1") =>
    request("/api/devices/register", {
      method: "POST",
      user,
      body: JSON.stringify({
        deviceId: ID,
        name: "Mac",
        platform: "macos",
        version: "1.0.0",
        capabilities: { exec: true, accessibility: true },
      }),
    });
  return { devices, relay, request, register };
}

describe("device routes", () => {
  it("requires a session on every route", async () => {
    const { request } = setup();
    for (const [method, path] of [
      ["POST", "/api/devices/register"],
      ["GET", `/api/devices/${ID}/requests`],
      ["POST", `/api/devices/${ID}/responses`],
      ["POST", `/api/devices/${ID}/heartbeat`],
      ["DELETE", `/api/devices/${ID}`],
    ] as const)
      expect((await request(path, { method })).status).toBe(401);
  });

  it("registers, re-registers, and refuses another user's device id", async () => {
    const { register, devices } = setup();
    const created = await register();
    expect(await created.json()).toMatchObject({ deviceId: ID, name: "Mac" });
    expect(devices.get(ID).capabilities).toMatchObject({ accessibility: true });
    expect((await register()).status).toBe(200);
    expect((await register("u2")).status).toBe(403);
  });

  it("rejects invalid registrations", async () => {
    const { request } = setup();
    const response = await request("/api/devices/register", {
      method: "POST",
      user: "u1",
      body: JSON.stringify({ deviceId: "x", name: "", platform: "windows" }),
    });
    expect(response.status).toBe(400);
  });

  it("hides devices from other users", async () => {
    const { register, request } = setup();
    await register();
    expect(
      (await request(`/api/devices/${ID}/heartbeat`, { method: "POST", user: "u2" })).status,
    ).toBe(404);
    expect((await request(`/api/devices/${ID}/requests`, { user: "u2" })).status).toBe(404);
    expect((await request(`/api/devices/${ID}`, { method: "DELETE", user: "u2" })).status).toBe(
      404,
    );
    expect(
      await (await request(`/api/devices/${ID}/heartbeat`, { method: "POST", user: "u1" })).json(),
    ).toEqual({ ok: true });
  });

  it("streams requests as server-sent events and accepts responses", async () => {
    const { register, request, relay, devices } = setup();
    await register();
    const stream = await request(`/api/devices/${ID}/requests`, { user: "u1" });
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await readUntil(": keepalive");
    expect(devices.get(ID).lastSeenAt.getTime()).toBeGreaterThan(0);
    const call = relay.call(ID, { op: "info" }, { timeoutMs: 2000 });
    await readUntil("event: request");
    const data = text.split("event: request\ndata: ")[1]!.split("\n")[0]!;
    const message = JSON.parse(data);
    expect(message).toMatchObject({ request: { op: "info" }, timeoutMs: 2000 });

    const bad = await request(`/api/devices/${ID}/responses`, {
      method: "POST",
      user: "u1",
      body: JSON.stringify({ id: "unissued", ok: true, result: 1 }),
    });
    expect(bad.status).toBe(404);
    const ok = await request(`/api/devices/${ID}/responses`, {
      method: "POST",
      user: "u1",
      body: JSON.stringify({ id: message.id, ok: true, result: { v: 1 } }),
    });
    expect(ok.status).toBe(204);
    await expect(call).resolves.toEqual({ v: 1 });
    await reader.cancel();
  });

  it("closes the old stream with a replaced event", async () => {
    const { register, request } = setup();
    await register();
    const first = await request(`/api/devices/${ID}/requests`, { user: "u1" });
    const reader = first.body!.getReader();
    await request(`/api/devices/${ID}/requests`, { user: "u1" });
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toContain("event: replaced");
  });

  it("rejects oversized responses and unregisters devices", async () => {
    const { register, request, relay, devices } = setup();
    await register();
    const large = await request(`/api/devices/${ID}/responses`, {
      method: "POST",
      user: "u1",
      headers: { "content-length": String(33 * 1024 * 1024) },
      body: "{}",
    });
    expect(large.status).toBe(413);
    await relay.attach(ID, { send: () => undefined, close: () => undefined });
    const removed = await request(`/api/devices/${ID}`, { method: "DELETE", user: "u1" });
    expect(removed.status).toBe(200);
    expect(devices.has(ID)).toBe(false);
    expect(await relay.isOnline(ID)).toBe(false);
  });
});
