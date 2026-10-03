import { describe, expect, it } from "vitest";
import {
  type DeviceRequestMessage,
  type DeviceSink,
  MemoryDeviceRelay,
  PostgresDeviceRelay,
} from "./device-relay.js";

function sinkFor(received: DeviceRequestMessage[] = []) {
  const closed: string[] = [];
  const sink: DeviceSink = {
    send: (message) => received.push(message),
    close: (reason) => closed.push(reason),
  };
  return { sink, received, closed };
}

describe("MemoryDeviceRelay", () => {
  it("relays a request to the attached device and returns its result", async () => {
    const relay = new MemoryDeviceRelay();
    const device = sinkFor();
    await relay.attach("device-1", device.sink);
    const pending = relay.call("device-1", { op: "info" }, { timeoutMs: 1000 });
    expect(device.received).toHaveLength(1);
    expect(device.received[0]?.request).toEqual({ op: "info" });
    expect(
      await relay.respond("device-1", { id: device.received[0]!.id, ok: true, result: 7 }),
    ).toBe(true);
    await expect(pending).resolves.toBe(7);
  });

  it("fails fast when the device is offline", async () => {
    const relay = new MemoryDeviceRelay();
    await expect(relay.call("missing", { op: "info" })).rejects.toMatchObject({
      name: "SandboxNotFoundError",
      message: "Device is offline",
    });
    expect(await relay.isOnline("missing")).toBe(false);
  });

  it("surfaces device errors and rejects responses from another device", async () => {
    const relay = new MemoryDeviceRelay();
    const device = sinkFor();
    await relay.attach("a", device.sink);
    const pending = relay.call("a", { op: "read" });
    const id = device.received[0]!.id;
    expect(await relay.respond("b", { id, ok: true, result: 1 })).toBe(false);
    await relay.respond("a", { id, ok: false, error: { name: "Denied", message: "No" } });
    await expect(pending).rejects.toMatchObject({ name: "Denied", message: "No" });
    expect(await relay.respond("a", { id, ok: true })).toBe(false);
  });

  it("replaces the previous stream and times out or aborts calls", async () => {
    const relay = new MemoryDeviceRelay();
    const first = sinkFor();
    const second = sinkFor();
    const detachFirst = await relay.attach("a", first.sink);
    await relay.attach("a", second.sink);
    expect(first.closed).toEqual(["replaced"]);
    await detachFirst();
    expect(await relay.isOnline("a")).toBe(true);
    await expect(relay.call("a", { op: "x" }, { timeoutMs: 5 })).rejects.toMatchObject({
      name: "TimeoutError",
    });
    const controller = new AbortController();
    const aborted = relay.call("a", { op: "x" }, { signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(aborted).rejects.toThrow("stop");
  });
});

type Row = {
  id: string;
  deviceId: string;
  request: unknown;
  status: string;
  result: unknown;
  error: unknown;
  createdAt: Date;
  expiresAt: Date;
};

/** Just enough of Prisma for the relay, shared by two relay instances like one database. */
function fakeDatabase() {
  const rows = new Map<string, Row>();
  const devices = new Map<string, { lastSeenAt: Date; revokedAt: Date | null }>();
  const listeners = new Set<(payload: string) => void>();
  let next = 0;
  const matches = (row: Row, where: Record<string, any>) =>
    (where.id === undefined ||
      (typeof where.id === "string" ? row.id === where.id : where.id.in.includes(row.id))) &&
    (where.deviceId === undefined || row.deviceId === where.deviceId) &&
    (where.status === undefined ||
      (typeof where.status === "string"
        ? row.status === where.status
        : where.status.in.includes(row.status))) &&
    (where.expiresAt === undefined ||
      (where.expiresAt.gt
        ? row.expiresAt > where.expiresAt.gt
        : row.expiresAt < where.expiresAt.lt));
  const prisma: any = {
    device: { findUnique: async ({ where }: any) => devices.get(where.id) ?? null },
    deviceRpc: {
      create: async ({ data }: any) => {
        const row: Row = {
          id: `rpc-${++next}`,
          result: null,
          error: null,
          status: "pending",
          createdAt: new Date(),
          ...data,
        };
        rows.set(row.id, row);
        return { id: row.id };
      },
      findMany: async ({ where }: any) => [...rows.values()].filter((row) => matches(row, where)),
      updateMany: async ({ where, data }: any) => {
        const hits = [...rows.values()].filter((row) => matches(row, where));
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    $queryRaw: async (_strings: TemplateStringsArray, _channel: string, payload: string) => {
      for (const listener of listeners) listener(payload);
      return [];
    },
  };
  const clientFactory = () => {
    let handler: ((n: { channel: string; payload?: string }) => void) | undefined;
    const listener = (payload: string) => handler?.({ channel: "cadre_device", payload });
    const client: any = {
      connect: async () => undefined,
      query: async () => {
        listeners.add(listener);
      },
      end: async () => {
        listeners.delete(listener);
      },
      on(event: string, fn: any) {
        if (event === "notification") handler = fn;
        return client;
      },
      removeAllListeners: () => client,
    };
    return client;
  };
  return { rows, devices, prisma, clientFactory };
}

describe("PostgresDeviceRelay", () => {
  it("delivers a request across processes and wakes the caller with the result", async () => {
    const db = fakeDatabase();
    db.devices.set("device-1", { lastSeenAt: new Date(), revokedAt: null });
    const make = () =>
      new PostgresDeviceRelay({
        prisma: db.prisma,
        connectionString: "postgres://unused",
        clientFactory: db.clientFactory,
        pollMs: 20,
        reconnectMs: 10,
      });
    const holder = make();
    const worker = make();
    try {
      const device = sinkFor();
      await holder.attach("device-1", device.sink);
      const pending = worker.call("device-1", { op: "info" }, { timeoutMs: 2000 });
      await expect.poll(() => device.received.length).toBe(1);
      const id = device.received[0]!.id;
      expect(await holder.respond("device-2", { id, ok: true })).toBe(false);
      expect(await holder.respond("device-1", { id, ok: true, result: { ok: 1 } })).toBe(true);
      await expect(pending).resolves.toEqual({ ok: 1 });
      expect(device.received).toHaveLength(1);
    } finally {
      await holder.close();
      await worker.close();
    }
  });

  it("is offline without a recent stream, and expires unanswered requests", async () => {
    const db = fakeDatabase();
    db.devices.set("stale", { lastSeenAt: new Date(Date.now() - 120_000), revokedAt: null });
    db.devices.set("live", { lastSeenAt: new Date(), revokedAt: null });
    const relay = new PostgresDeviceRelay({
      prisma: db.prisma,
      connectionString: "postgres://unused",
      clientFactory: db.clientFactory,
      pollMs: 20,
    });
    try {
      await expect(relay.call("stale", { op: "info" })).rejects.toMatchObject({
        name: "SandboxNotFoundError",
      });
      await expect(relay.call("live", { op: "info" }, { timeoutMs: 50 })).rejects.toMatchObject({
        name: "TimeoutError",
      });
      expect([...db.rows.values()].map((row) => row.status)).toEqual(["expired"]);
    } finally {
      await relay.close();
    }
  });
});
