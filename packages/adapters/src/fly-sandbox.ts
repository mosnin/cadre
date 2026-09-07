import { createHash, createHmac } from "node:crypto";
import type { AdapterContext, ComputerRef, SandboxProvider } from "@rakazo/adapter-kit";
import { LinuxDesktopSandbox } from "./linux-desktop-sandbox.js";

type Machine = {
  id: string;
  state: string;
  config: { metadata?: Record<string, string>; mounts?: Array<{ volume: string; path: string }> };
};
type Volume = {
  id: string;
  name: string;
  state?: string;
  attached_machine_id?: string | null;
};
export interface FlySandboxOptions {
  appName: string;
  apiToken: string;
  image: string;
  screenSecret: string;
  region?: string;
}

function gone() {
  const error = new Error("Cloud computer no longer exists");
  error.name = "SandboxNotFoundError";
  return error;
}

/** A team owns one continuously running VM and its own durable home volume. */
export class FlySandboxProvider extends LinuxDesktopSandbox<Machine> {
  constructor(
    private readonly options: FlySandboxOptions,
    private readonly request = fetch,
  ) {
    super();
    if (
      !/^[a-z0-9][a-z0-9-]{2,62}$/.test(options.appName) ||
      !options.apiToken ||
      !options.image ||
      options.screenSecret.length < 32
    )
      throw new Error("Fly computer configuration is incomplete");
  }
  describe() {
    return {
      id: "fly",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: false,
        snapshots: true,
        takeover: true,
        persistentHome: true,
        multiScreen: true,
        persistentRunning: true,
      },
    };
  }
  suspendWhenIdle() {
    return false;
  }
  private owner(homeKey: string, ctx: AdapterContext) {
    return createHash("sha256")
      .update(JSON.stringify([ctx.spaceId, homeKey]))
      .digest("hex");
  }
  protected viewToken(homeKey: string, ctx: AdapterContext) {
    return createHmac("sha256", this.options.screenSecret)
      .update(this.owner(homeKey, ctx))
      .digest("hex");
  }
  private rpcToken(owner: string) {
    return createHmac("sha256", this.options.screenSecret).update(`rpc:${owner}`).digest("hex");
  }
  private async api<T>(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.request(
      `https://api.machines.dev/v1/apps/${this.options.appName}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiToken}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(75000)])
          : AbortSignal.timeout(75000),
      },
    );
    if (response.status === 404) throw gone();
    if (!response.ok) throw new Error(`Computer host request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
  protected async owned(computer: ComputerRef, ctx: AdapterContext) {
    if (computer.kind !== "fly" || !/^[a-f0-9]{14,16}$/.test(computer.providerRef))
      throw new Error("Incorrect computer provider");
    const machine = await this.api<Machine>(
      `/machines/${computer.providerRef}`,
      "GET",
      undefined,
      ctx.signal,
    );
    if (machine.config.metadata?.cadre_owner !== this.owner(computer.botId, ctx))
      throw new Error("Computer access denied");
    return machine;
  }
  protected multiscreen() {
    return true;
  }
  protected async alive(machine: Machine) {
    return machine.state === "started";
  }
  protected async screenEndpoint(machine: Machine) {
    return `https://${this.options.appName}.fly.dev/m/${machine.id}/`;
  }
  protected async rpc<T>(
    machine: Machine,
    request: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<T> {
    const owner = machine.config.metadata?.cadre_owner;
    if (!owner || !/^[a-f0-9]{64}$/.test(owner)) throw new Error("Computer access denied");
    const response = await this.request(`${await this.screenEndpoint(machine)}rpc`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.rpcToken(owner)}`,
        "content-type": "application/json",
        "fly-force-instance-id": machine.id,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Computer connection failed (${response.status})`);
    const result = (await response.json()) as T & { error?: string };
    if (result.error) throw new Error(result.error);
    return result;
  }
  override async prepare(computer: ComputerRef, ctx: AdapterContext) {
    const machine = await this.owned(computer, ctx);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      ctx.signal.throwIfAborted();
      try {
        const response = await this.request(`${await this.screenEndpoint(machine)}health`, {
          headers: { "fly-force-instance-id": machine.id },
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(3000)]),
        });
        if (response.ok) return super.prepare(computer, ctx);
      } catch {
        ctx.signal.throwIfAborted();
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Cloud desktop did not become ready");
  }
  async provision(
    req: Parameters<SandboxProvider["provision"]>[0],
    ctx: AdapterContext,
  ): Promise<ComputerRef> {
    const owner = this.owner(req.botId, ctx);
    let machine: Machine | undefined;
    if (req.providerKind === "fly" && req.providerRef) {
      try {
        machine = await this.owned(
          { id: req.providerRef, providerRef: req.providerRef, botId: req.botId, kind: "fly" },
          ctx,
        );
      } catch (error) {
        if (!(error instanceof Error && error.name === "SandboxNotFoundError")) throw error;
      }
    }
    if (!machine) {
      const matches = (await this.api<Machine[]>("/machines", "GET", undefined, ctx.signal)).filter(
        (m) => m.config.metadata?.cadre_owner === owner && m.state !== "destroyed",
      );
      if (matches.length > 1) throw new Error("Computer host has duplicate workspace machines");
      machine = matches[0];
    }
    let fresh = false;
    if (!machine) {
      const volumeName = `home_${owner.slice(0, 24)}`;
      const volumes = (await this.api<Volume[]>("/volumes", "GET", undefined, ctx.signal)).filter(
        (v) => v.name === volumeName && v.state !== "pending_destroy" && v.state !== "destroyed",
      );
      if (volumes.length > 1 || volumes.some((v) => v.attached_machine_id))
        throw new Error("Workspace disk is already attached");
      if (volumes.some((v) => v.state && v.state !== "created"))
        throw new Error("Workspace disk is not ready");
      const volume =
        volumes[0] ??
        (await this.api<Volume>(
          "/volumes",
          "POST",
          { name: volumeName, region: this.options.region ?? "iad", size_gb: 10, encrypted: true },
          ctx.signal,
        ));
      machine = await this.api<Machine>(
        "/machines",
        "POST",
        {
          name: `cadre-${owner.slice(0, 24)}`,
          region: this.options.region ?? "iad",
          config: {
            image: this.options.image,
            metadata: { cadre_owner: owner, cadre_protocol: "2" },
            env: {
              HOME: "/home/rakazo",
              DISPLAY: ":1",
              CADRE_SCREEN_VIEW_TOKEN: this.viewToken(req.botId, ctx),
              CADRE_RPC_TOKEN: this.rpcToken(owner),
            },
            guest: { cpu_kind: "shared", cpus: 2, memory_mb: 4096 },
            mounts: [{ volume: volume.id, path: "/home/rakazo" }],
            restart: { policy: "always" },
            services: [
              {
                protocol: "tcp",
                internal_port: 8080,
                autostop: "off",
                autostart: false,
                ports: [{ port: 443, handlers: ["tls", "http"] }],
              },
            ],
          },
        },
        ctx.signal,
      );
      fresh = volumes.length === 0;
    } else if (["stopped", "suspended"].includes(machine.state)) {
      await this.api(`/machines/${machine.id}/start`, "POST", {}, ctx.signal);
    }
    if (machine.state !== "started") {
      await this.api(
        `/machines/${machine.id}/wait?state=started&timeout=60`,
        "GET",
        undefined,
        ctx.signal,
      );
    }
    return {
      id: machine.id,
      providerRef: machine.id,
      botId: req.botId,
      kind: "fly",
      fresh,
      workspaceRestored: !fresh,
    };
  }
  async snapshot(computer: ComputerRef, ctx: AdapterContext) {
    const machine = await this.owned(computer, ctx);
    const volume = machine.config.mounts?.find((m) => m.path === "/home/rakazo")?.volume;
    if (!volume) throw new Error("Workspace disk is unavailable");
    const result = await this.api<{ Msg?: { backup?: { graph_id?: string } } }>(
      `/volumes/${volume}/snapshots`,
      "POST",
      undefined,
      ctx.signal,
    );
    const id = result.Msg?.backup?.graph_id;
    if (!id) throw new Error("Computer backup did not start");
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      ctx.signal.throwIfAborted();
      const snapshots = await this.api<
        Array<{ id: string; digest: string; size: number; created_at: string; status?: string }>
      >(`/volumes/${volume}/snapshots`, "GET", undefined, ctx.signal);
      const snapshot = snapshots.find((entry) => entry.id === id);
      if (snapshot?.digest && snapshot.size > 0) return { id, createdAt: snapshot.created_at };
      if (snapshot?.status === "failed") throw new Error("Computer backup failed");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Computer backup is still being prepared");
  }

  async stop(computer: ComputerRef, ctx: AdapterContext) {
    const machine = await this.owned(computer, ctx);
    if (machine.state !== "stopped") {
      await this.api(`/machines/${machine.id}/stop`, "POST", { timeout: "30s" }, ctx.signal);
      await this.api(
        `/machines/${machine.id}/wait?state=stopped&timeout=60`,
        "GET",
        undefined,
        ctx.signal,
      );
    }
  }
  async destroy(computer: ComputerRef, ctx: AdapterContext) {
    const machine = await this.owned(computer, ctx);
    await this.stop(computer, ctx);
    await this.api(`/machines/${machine.id}?force=true`, "DELETE", undefined, ctx.signal);
    const volume = machine.config.mounts?.find((m) => m.path === "/home/rakazo")?.volume;
    if (volume) await this.api(`/volumes/${volume}`, "DELETE", undefined, ctx.signal);
  }
}
