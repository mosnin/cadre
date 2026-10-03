import type {
  AdapterContext,
  BrowserRequest,
  ComputerRef,
  SandboxProvider,
  ScreenRequest,
} from "@cadre/adapter-kit";
import type { PrismaClient } from "@cadre/db";
import type { DeviceRelay } from "./device-relay.js";
import { LinuxDesktopSandbox } from "./linux-desktop-sandbox.js";

export interface DeviceHandle {
  deviceId: string;
  /** Workspace the device keeps this computer's files in. */
  workspace: string;
  capabilities: DeviceCapabilitiesRecord;
}

export type DeviceCapabilitiesRecord = {
  exec?: boolean;
  files?: boolean;
  screen?: boolean;
  input?: boolean;
  accessibility?: boolean;
  browser?: boolean;
  multiscreen?: boolean;
  permissions?: Record<string, boolean>;
};

export interface DeviceToolResult {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

export interface DeviceInfo {
  platform: string;
  version: string;
  displays: Array<{ id: string; width: number; height: number; scale: number }>;
  capabilities: DeviceCapabilitiesRecord;
}

type DeviceDb = Pick<PrismaClient, "device" | "bot">;

function offline(): Error {
  const error = new Error("Device is offline");
  error.name = "SandboxNotFoundError";
  return error;
}

/** A Burst device the user owns, driven through the same ops as the Linux VM agent. */
export class DeviceSandboxProvider extends LinuxDesktopSandbox<DeviceHandle> {
  constructor(private readonly deps: { prisma: DeviceDb; relay: DeviceRelay }) {
    super();
  }

  describe() {
    return {
      id: "device",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        browser: true,
        pty: false,
        snapshots: false,
        takeover: false,
        persistentHome: true,
        multiScreen: false,
        sharedInput: false,
      },
    };
  }

  suspendWhenIdle() {
    return false;
  }

  requiresRunningForWorkspaceAccess() {
    return true;
  }

  protected viewToken(): string {
    throw new Error("Device computers have no screen stream");
  }

  protected async screenEndpoint(): Promise<string> {
    throw new Error("Device computers have no screen stream");
  }

  protected multiscreen(handle: DeviceHandle) {
    return handle.capabilities.multiscreen === true;
  }

  protected async alive(handle: DeviceHandle) {
    return this.deps.relay.isOnline(handle.deviceId);
  }

  /** Only the bots assigned to a device, in the owner's space, may reach it. */
  protected async owned(computer: ComputerRef, ctx: AdapterContext): Promise<DeviceHandle> {
    if (computer.kind !== "device" || !computer.providerRef)
      throw new Error("Incorrect computer provider");
    const device = await this.deps.prisma.device.findUnique({
      where: { id: computer.providerRef },
      select: { id: true, userId: true, revokedAt: true, capabilities: true },
    });
    if (!device || device.revokedAt) throw offline();
    const assigned = await this.deps.prisma.bot.findFirst({
      where: { deviceId: device.id, spaceId: ctx.spaceId, userId: device.userId },
      select: { id: true },
    });
    if (!assigned) throw new Error("Computer access denied");
    return {
      deviceId: device.id,
      workspace: computer.botId,
      capabilities: (device.capabilities ?? {}) as DeviceCapabilitiesRecord,
    };
  }

  protected async rpc<T>(
    handle: DeviceHandle,
    request: Record<string, unknown>,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ): Promise<T> {
    const result = await this.deps.relay.call(
      handle.deviceId,
      { ...request, workspace: handle.workspace },
      { timeoutMs, signal },
    );
    if (result && typeof result === "object" && "error" in result && result.error)
      throw new Error(String(result.error));
    return result as T;
  }

  async provision(
    req: Parameters<SandboxProvider["provision"]>[0],
    ctx: AdapterContext,
  ): Promise<ComputerRef> {
    const bot = await this.deps.prisma.bot.findFirst({
      where: {
        spaceId: ctx.spaceId,
        deviceId: { not: null },
        // Dedicated computers use the bot id as their home key; Team computers run for ctx.botId.
        id: ctx.botId ?? req.botId,
      },
      select: { deviceId: true, userId: true },
    });
    if (!bot?.deviceId) throw new Error("Assign a device to this bot in Burst");
    const device = await this.deps.prisma.device.findUnique({
      where: { id: bot.deviceId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!device || device.revokedAt || device.userId !== bot.userId)
      throw new Error("Assign a device to this bot in Burst");
    return {
      id: device.id,
      providerRef: device.id,
      botId: req.botId,
      kind: "device",
      workspaceRestored: req.providerKind === "device" && req.providerRef === device.id,
    };
  }

  override async prepare(computer: ComputerRef, ctx: AdapterContext) {
    if (!(await this.alive(await this.owned(computer, ctx)))) throw offline();
  }

  override async browser(computer: ComputerRef, request: BrowserRequest, ctx: AdapterContext) {
    // The secret stays inside the TLS request to the device and is never logged.
    return this.rpc<Record<string, unknown>>(
      await this.owned(computer, ctx),
      { ...request, op: "browser" },
      30000,
      ctx.signal,
    );
  }

  /** The device has no VNC endpoint, so every viewer gets polled snapshot frames. */
  override connectScreen(computer: ComputerRef, request: ScreenRequest, ctx: AdapterContext) {
    return super.connectScreen(computer, { ...request, view: "snapshot" }, ctx);
  }

  async accessibility(
    computer: ComputerRef,
    request: { tool: string; args?: Record<string, unknown> },
    ctx: AdapterContext,
  ) {
    return this.rpc<DeviceToolResult>(
      await this.owned(computer, ctx),
      { op: "ax", tool: request.tool, args: request.args ?? {} },
      60000,
      ctx.signal,
    );
  }

  async info(computer: ComputerRef, ctx: AdapterContext) {
    return this.rpc<DeviceInfo>(await this.owned(computer, ctx), { op: "info" }, 15000, ctx.signal);
  }

  async snapshot(): Promise<never> {
    throw new Error("Device computers do not support snapshots");
  }

  // The machine belongs to the user; Burst only stops using it.
  async stop() {}
  async destroy() {}
}
