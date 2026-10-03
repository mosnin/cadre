import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@cadre/db";
import { Client, type Notification } from "pg";
import type { RealtimeListenerClient } from "./realtime.js";

/** Request pushed to the device over its stream. */
export interface DeviceRequestMessage {
  id: string;
  request: Record<string, unknown>;
  timeoutMs: number;
}

export type DeviceResponse =
  | { id: string; ok: true; result?: unknown }
  | { id: string; ok: false; error: { name?: string; message: string } };

/** The stream holder for a device. The relay pushes requests to it. */
export interface DeviceSink {
  send(message: DeviceRequestMessage): void;
  close(reason: "replaced" | "revoked"): void;
}

export interface DeviceCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DeviceRelay {
  call(
    deviceId: string,
    request: Record<string, unknown>,
    options?: DeviceCallOptions,
  ): Promise<unknown>;
  /** Make this process the holder of the device's stream. A previous local holder is replaced. */
  attach(deviceId: string, sink: DeviceSink): Promise<() => Promise<void>>;
  /** Returns false when the id was not issued to this device or already answered. */
  respond(deviceId: string, response: DeviceResponse): Promise<boolean>;
  isOnline(deviceId: string): Promise<boolean>;
  /** Close the local stream and fail pending requests (device removed). */
  revoke(deviceId: string): Promise<void>;
  close(): Promise<void>;
}

export const DEVICE_DEFAULT_TIMEOUT_MS = 30_000;
/** A device counts as online this long after its stream last proved liveness. */
export const DEVICE_ONLINE_WINDOW_MS = 45_000;
const DEVICE_CHANNEL = "cadre_device";
const POLL_MS = 1_000;

export function deviceOffline(): Error {
  const error = new Error("Device is offline");
  error.name = "SandboxNotFoundError";
  return error;
}

function remoteError(error: { name?: string; message?: string } | null | undefined): Error {
  const result = new Error(error?.message || "Device request failed");
  if (error?.name) result.name = error.name;
  return result;
}

function timeoutError(): Error {
  const error = new Error("Device did not respond in time");
  error.name = "TimeoutError";
  return error;
}

function clampTimeout(timeoutMs: number | undefined) {
  return Math.min(Math.max(Math.round(timeoutMs ?? DEVICE_DEFAULT_TIMEOUT_MS), 1), 3_700_000);
}

/** Single-process relay, for development and deployments without PostgreSQL. */
export class MemoryDeviceRelay implements DeviceRelay {
  private readonly sinks = new Map<string, DeviceSink>();
  private readonly waiting = new Map<
    string,
    { deviceId: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  async isOnline(deviceId: string) {
    return this.sinks.has(deviceId);
  }

  async attach(deviceId: string, sink: DeviceSink) {
    this.sinks.get(deviceId)?.close("replaced");
    this.sinks.set(deviceId, sink);
    return async () => {
      if (this.sinks.get(deviceId) === sink) this.sinks.delete(deviceId);
    };
  }

  async call(deviceId: string, request: Record<string, unknown>, options: DeviceCallOptions = {}) {
    options.signal?.throwIfAborted();
    const sink = this.sinks.get(deviceId);
    if (!sink) throw deviceOffline();
    const timeoutMs = clampTimeout(options.timeoutMs);
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        this.waiting.delete(id);
      };
      const onAbort = () => {
        finish();
        reject(options.signal?.reason ?? new Error("Aborted"));
      };
      timer = setTimeout(() => {
        finish();
        reject(timeoutError());
      }, timeoutMs);
      timer.unref?.();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.set(id, {
        deviceId,
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      try {
        sink.send({ id, request, timeoutMs });
      } catch {
        finish();
        reject(deviceOffline());
      }
    });
  }

  async respond(deviceId: string, response: DeviceResponse) {
    const entry = this.waiting.get(response.id);
    if (!entry || entry.deviceId !== deviceId) return false;
    if (response.ok) entry.resolve(response.result);
    else entry.reject(remoteError(response.error));
    return true;
  }

  async revoke(deviceId: string) {
    this.sinks.get(deviceId)?.close("revoked");
    this.sinks.delete(deviceId);
    for (const entry of [...this.waiting.values()])
      if (entry.deviceId === deviceId) entry.reject(deviceOffline());
  }

  async close() {
    for (const deviceId of [...this.sinks.keys()]) await this.revoke(deviceId);
  }
}

export interface PostgresDeviceRelayOptions {
  prisma: PrismaClient;
  connectionString: string;
  clientFactory?: () => RealtimeListenerClient;
  pollMs?: number;
  reconnectMs?: number;
}

type Waiter = (row: { status: string; result: unknown; error: unknown } | null) => void;

/**
 * Cross-process relay. A caller inserts a DeviceRpc row and notifies; the process holding the
 * device's stream delivers it. The device's response updates the row and notifies the caller.
 * Only ids go through NOTIFY (the payload limit is 8 KB). Every side also polls each second so a
 * lost notification only costs latency.
 */
export class PostgresDeviceRelay implements DeviceRelay {
  private readonly local = new Map<string, DeviceSink>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly clientFactory: () => RealtimeListenerClient;
  private readonly pollMs: number;
  private readonly reconnectMs: number;
  private client: RealtimeListenerClient | undefined;
  private connecting: Promise<void> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private closed = false;

  constructor(private readonly options: PostgresDeviceRelayOptions) {
    this.clientFactory =
      options.clientFactory ??
      (() =>
        new Client({
          connectionString: options.connectionString,
          application_name: "cadre-device-relay",
          connectionTimeoutMillis: 5_000,
        }) as RealtimeListenerClient);
    this.pollMs = options.pollMs ?? POLL_MS;
    this.reconnectMs = options.reconnectMs ?? 1_000;
  }

  private notify(payload: Record<string, string>) {
    return this.options.prisma
      .$queryRaw`SELECT pg_notify(${DEVICE_CHANNEL}, ${JSON.stringify(payload)})`.catch(
      () => undefined,
    );
  }

  async isOnline(deviceId: string) {
    if (this.local.has(deviceId)) return true;
    const device = await this.options.prisma.device.findUnique({
      where: { id: deviceId },
      select: { lastSeenAt: true, revokedAt: true },
    });
    return Boolean(
      device &&
        !device.revokedAt &&
        Date.now() - device.lastSeenAt.getTime() < DEVICE_ONLINE_WINDOW_MS,
    );
  }

  async call(deviceId: string, request: Record<string, unknown>, options: DeviceCallOptions = {}) {
    options.signal?.throwIfAborted();
    if (!(await this.isOnline(deviceId))) throw deviceOffline();
    const timeoutMs = clampTimeout(options.timeoutMs);
    this.start();
    const { prisma } = this.options;
    const row = await prisma.deviceRpc.create({
      data: {
        deviceId,
        request: request as never,
        expiresAt: new Date(Date.now() + timeoutMs),
      },
      select: { id: true },
    });
    const id = row.id;
    const outcome = new Promise<unknown>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const check: Waiter = (current) => {
        if (settled) return;
        if (!current) return settle(() => reject(deviceOffline()));
        if (current.status === "completed")
          return settle(() => resolve(current.result ?? undefined));
        if (current.status === "failed")
          return settle(() =>
            reject(remoteError(current.error as { name?: string; message?: string })),
          );
        if (current.status === "expired") return settle(() => reject(timeoutError()));
      };
      const onAbort = () => {
        void expire();
        settle(() => reject(options.signal?.reason ?? new Error("Aborted")));
      };
      const expire = () =>
        prisma.deviceRpc
          .updateMany({
            where: { id, status: { in: ["pending", "delivered"] } },
            data: { status: "expired" },
          })
          .catch(() => undefined);
      const settle = (action: () => void) => {
        settled = true;
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        const set = this.waiters.get(id);
        set?.delete(check);
        if (set?.size === 0) this.waiters.delete(id);
        action();
      };
      timer = setTimeout(() => {
        void expire();
        settle(() => reject(timeoutError()));
      }, timeoutMs);
      timer.unref?.();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const set = this.waiters.get(id) ?? new Set();
      set.add(check);
      this.waiters.set(id, set);
    });
    await this.notify({ deviceId, id });
    return outcome;
  }

  async attach(deviceId: string, sink: DeviceSink) {
    this.local.get(deviceId)?.close("replaced");
    this.local.set(deviceId, sink);
    this.start();
    void this.deliver(deviceId).catch(() => undefined);
    return async () => {
      if (this.local.get(deviceId) === sink) this.local.delete(deviceId);
    };
  }

  async respond(deviceId: string, response: DeviceResponse) {
    const updated = await this.options.prisma.deviceRpc.updateMany({
      where: { id: response.id, deviceId, status: "delivered", expiresAt: { gt: new Date() } },
      data: response.ok
        ? { status: "completed", result: (response.result ?? null) as never }
        : { status: "failed", error: response.error as never },
    });
    if (updated.count !== 1) return false;
    this.wake(response.id, response.ok ? "completed" : "failed", response);
    await this.notify({ resultId: response.id });
    return true;
  }

  async revoke(deviceId: string) {
    this.local.get(deviceId)?.close("revoked");
    this.local.delete(deviceId);
    // Rows are removed with the device; waiters see a missing row on their next check.
    this.checkWaiters();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const sink of this.local.values()) sink.close("revoked");
    this.local.clear();
    const client = this.client;
    this.client = undefined;
    if (client) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
    }
  }

  private wake(id: string, status: string, response: DeviceResponse) {
    const row = {
      status,
      result: response.ok ? response.result : undefined,
      error: response.ok ? undefined : response.error,
    };
    for (const waiter of [...(this.waiters.get(id) ?? [])]) waiter(row);
  }

  private start() {
    if (this.closed) return;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.tick(), this.pollMs);
      this.pollTimer.unref?.();
    }
    if (!this.client && !this.connecting) {
      this.connecting = this.connect()
        .catch(() => this.scheduleReconnect())
        .finally(() => {
          this.connecting = undefined;
        });
    }
  }

  private async connect() {
    const candidate = this.clientFactory();
    const lost = () => {
      if (this.client !== candidate) return;
      this.client = undefined;
      candidate.removeAllListeners();
      void candidate.end().catch(() => undefined);
      this.scheduleReconnect();
    };
    candidate.on("notification", (n) => this.onNotification(n));
    candidate.on("error", lost);
    candidate.on("end", lost);
    try {
      await candidate.connect();
      await candidate.query(`LISTEN ${DEVICE_CHANNEL}`);
    } catch (error) {
      candidate.removeAllListeners();
      await candidate.end().catch(() => undefined);
      throw error;
    }
    if (this.closed) {
      candidate.removeAllListeners();
      await candidate.end().catch(() => undefined);
      return;
    }
    this.client = candidate;
    void this.tick();
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start();
    }, this.reconnectMs);
    this.reconnectTimer.unref?.();
  }

  private onNotification(notification: Notification) {
    if (notification.channel !== DEVICE_CHANNEL || !notification.payload) return;
    try {
      const body = JSON.parse(notification.payload) as {
        deviceId?: unknown;
        resultId?: unknown;
      };
      if (typeof body.deviceId === "string" && this.local.has(body.deviceId))
        void this.deliver(body.deviceId).catch(() => undefined);
      if (typeof body.resultId === "string" && this.waiters.has(body.resultId))
        void this.checkWaiters(body.resultId);
    } catch {
      // Malformed signals are ignored; the poll recovers.
    }
  }

  /** Push every pending request for a device this process holds. */
  private async deliver(deviceId: string) {
    const sink = this.local.get(deviceId);
    if (!sink) return;
    const { prisma } = this.options;
    const rows = await prisma.deviceRpc.findMany({
      where: { deviceId, status: "pending", expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "asc" },
      select: { id: true, request: true, expiresAt: true },
      take: 50,
    });
    for (const row of rows) {
      // Claiming makes delivery exactly-once across processes and overlapping polls.
      const claimed = await prisma.deviceRpc.updateMany({
        where: { id: row.id, status: "pending" },
        data: { status: "delivered" },
      });
      if (claimed.count !== 1) continue;
      try {
        sink.send({
          id: row.id,
          request: row.request as Record<string, unknown>,
          timeoutMs: Math.max(1, row.expiresAt.getTime() - Date.now()),
        });
      } catch {
        await prisma.deviceRpc
          .updateMany({ where: { id: row.id, status: "delivered" }, data: { status: "pending" } })
          .catch(() => undefined);
      }
    }
  }

  private async checkWaiters(onlyId?: string) {
    const ids = onlyId ? [onlyId] : [...this.waiters.keys()];
    if (!ids.length) return;
    const rows = await this.options.prisma.deviceRpc.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, result: true, error: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids)
      for (const waiter of [...(this.waiters.get(id) ?? [])]) waiter(byId.get(id) ?? null);
  }

  private async tick() {
    if (this.polling || this.closed) return;
    this.polling = true;
    try {
      const { prisma } = this.options;
      await prisma.deviceRpc.updateMany({
        where: { status: { in: ["pending", "delivered"] }, expiresAt: { lt: new Date() } },
        data: { status: "expired" },
      });
      for (const deviceId of [...this.local.keys()]) await this.deliver(deviceId);
      await this.checkWaiters();
      // Settled rows are history for a short while only.
      if (Math.random() < 0.01)
        await prisma.deviceRpc.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - 3_600_000) } },
        });
    } catch {
      // The next tick retries.
    } finally {
      this.polling = false;
    }
  }
}
