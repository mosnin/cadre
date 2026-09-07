import { createHash, createHmac } from "node:crypto";
import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { AlreadyExistsError, ModalClient, NotFoundError, type Sandbox } from "modal";
import { LinuxDesktopSandbox } from "./linux-desktop-sandbox.js";

export interface ModalSandboxOptions {
  imageId: string;
  screenSecret: string;
  appName?: string;
  tokenId?: string;
  tokenSecret?: string;
}
/** Normalize only provider-reported terminal states, never shell or transport errors. */
function modalOperationError(error: unknown): unknown {
  if (
    error instanceof NotFoundError ||
    (error instanceof Error &&
      error.name === "ClientError" &&
      /^\/modal\.client\.ModalClient\/Sandbox\w+ FAILED_PRECONDITION: Sandbox has already finished with status \w+/.test(
        error.message,
      )) ||
    (error instanceof Error &&
      /^Sandbox sb-[A-Za-z0-9]+ has already completed with result: /.test(error.message))
  ) {
    const missing = new Error("Cloud computer no longer exists", { cause: error });
    missing.name = "SandboxNotFoundError";
    return missing;
  }
  return error;
}

/** Modal runs the computer; durable homes remain in the configured AgentHomeStore. */
export class ModalSandboxProvider extends LinuxDesktopSandbox<Sandbox> {
  private readonly client: ModalClient;
  private readonly appName: string;
  private readonly protocols = new Map<string, boolean>();
  private readonly images = new Map<string, string>();
  constructor(
    private readonly options: ModalSandboxOptions,
    client?: ModalClient,
  ) {
    super();
    if (!options.imageId || options.screenSecret.length < 32)
      throw new Error("Modal image and a strong screen secret are required");
    this.client =
      client ?? new ModalClient({ tokenId: options.tokenId, tokenSecret: options.tokenSecret });
    this.appName = options.appName ?? "cadre-computers";
  }
  describe() {
    return {
      id: "modal",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        graphical: true,
        pty: false,
        snapshots: true,
        takeover: true,
        persistentHome: false,
        multiScreen: true,
      },
    };
  }
  private owner(homeKey: string, ctx: AdapterContext) {
    // Computers can be shared by members of a space; never attach across spaces.
    return createHash("sha256")
      .update(JSON.stringify([ctx.spaceId, homeKey]))
      .digest("hex");
  }
  protected viewToken(homeKey: string, ctx: AdapterContext) {
    return createHmac("sha256", this.options.screenSecret)
      .update(this.owner(homeKey, ctx))
      .digest("hex");
  }
  protected async owned(computer: ComputerRef, ctx: AdapterContext) {
    if (computer.kind !== "modal") throw new Error("Incorrect computer provider");
    const sandbox = await this.client.sandboxes.fromId(computer.providerRef).catch((error) => {
      throw modalOperationError(error);
    });
    const tags = await sandbox.getTags().catch((error) => {
      throw modalOperationError(error);
    });
    if (tags.cadre_owner !== this.owner(computer.botId, ctx))
      throw new Error("Computer access denied");
    this.protocols.set(sandbox.sandboxId, tags.cadre_protocol === "2");
    this.images.set(sandbox.sandboxId, tags.cadre_image ?? "");
    return sandbox;
  }
  async provision(
    req: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
      workspaceSnapshot?: string;
    },
    ctx: AdapterContext,
  ): Promise<ComputerRef> {
    const owner = this.owner(req.botId, ctx);
    const ref = (sandbox: Sandbox, fresh: boolean): ComputerRef => ({
      id: sandbox.sandboxId,
      providerRef: sandbox.sandboxId,
      botId: req.botId,
      kind: "modal",
      fresh,
    });
    if (req.providerRef && req.providerKind === "modal") {
      try {
        const sandbox = await this.owned(
          { id: req.providerRef, providerRef: req.providerRef, botId: req.botId, kind: "modal" },
          ctx,
        );
        if ((await sandbox.poll()) === null) return ref(sandbox, false);
      } catch (e) {
        if (
          !(e instanceof NotFoundError) &&
          !(e instanceof Error && e.name === "SandboxNotFoundError")
        )
          throw e;
      }
    }
    const name = `cadre-${owner.slice(0, 48)}`;
    const existing = async () => {
      const sandbox = await this.client.sandboxes.fromName(this.appName, name);
      if ((await sandbox.getTags()).cadre_owner !== owner)
        throw new Error("Computer access denied");
      if ((await sandbox.poll()) !== null) throw new NotFoundError("Computer has stopped");
      return ref(sandbox, false);
    };
    try {
      return await existing();
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
    const app = await this.client.apps.fromName(this.appName, { createIfMissing: true });
    let imageId = this.options.imageId;
    if (req.workspaceSnapshot) {
      try {
        const snapshot = JSON.parse(req.workspaceSnapshot);
        if (
          snapshot.owner === owner &&
          snapshot.baseImage === this.options.imageId &&
          /^im-[A-Za-z0-9]+$/.test(snapshot.imageId) &&
          snapshot.expiresAt > Date.now()
        )
          imageId = snapshot.imageId;
      } catch {
        /* An invalid cache is never authority to restore another workspace. */
      }
    }
    const startedAt = Date.now();
    const create = async (selectedImage: string) => {
      const image = await this.client.images.fromId(selectedImage);
      const result = ref(
        await this.client.sandboxes.create(app, image, {
          name,
          tags: { cadre_owner: owner, cadre_protocol: "2", cadre_image: this.options.imageId },
          command: ["bash", "/opt/cadre/start.sh"],
          cpu: 2,
          memoryMiB: 4096,
          timeoutMs: 24 * 60 * 60 * 1000,
          encryptedPorts: [8080],
          env: {
            CADRE_SCREEN_VIEW_TOKEN: this.viewToken(req.botId, ctx),
            HOME: "/home/rakazo",
            DISPLAY: ":1",
          },
        }),
        true,
      );
      result.workspaceRestored = selectedImage !== this.options.imageId;
      getLogger().info("computer.provisioned", {
        durationMs: Date.now() - startedAt,
        restoredSnapshot: result.workspaceRestored,
      });
      return result;
    };
    try {
      return await create(imageId);
    } catch (e) {
      if (e instanceof AlreadyExistsError) return existing();
      if (imageId !== this.options.imageId && e instanceof NotFoundError)
        return create(this.options.imageId);
      throw e;
    }
  }
  protected async rpc<T>(
    sandbox: Sandbox,
    request: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<T> {
    const process = await sandbox
      .exec(["python3", "/opt/cadre/computer_rpc.py"], {
        timeoutMs,
        mode: "text",
      })
      .catch((error) => {
        throw modalOperationError(error);
      });
    // Modal limits each stdin message to 20 MiB. Browser profiles and other
    // portable files can be larger, especially after base64 encoding.
    // Untagged running images retain their primary-display protocol during rollout.
    const wireRequest = this.protocols.get(sandbox.sandboxId)
      ? request
      : { ...request, screenKey: undefined, screenLease: undefined };
    const input = Buffer.from(JSON.stringify(wireRequest));
    try {
      for (let offset = 0; offset < input.length; offset += 1024 * 1024) {
        await process.stdin.writeBytes(input.subarray(offset, offset + 1024 * 1024));
      }
    } finally {
      await process.stdin.close();
    }
    const [stdout, , code] = await Promise.all([
      process.stdout.readText(),
      process.stderr.readText(),
      process.wait(),
    ]);
    let result: T & { error?: string };
    try {
      result = JSON.parse(stdout);
    } catch {
      throw new Error("Computer returned an invalid response");
    }
    if (code !== 0 || result.error) throw new Error(result.error ?? "Computer operation failed");
    return result;
  }
  protected multiscreen(sandbox: Sandbox) {
    return this.protocols.get(sandbox.sandboxId) === true;
  }
  protected async alive(sandbox: Sandbox) {
    return (await sandbox.poll()) === null;
  }
  protected async screenEndpoint(sandbox: Sandbox) {
    const tunnel = (
      await sandbox.tunnels().catch((error) => {
        throw modalOperationError(error);
      })
    )[8080];
    if (!tunnel) throw new Error("Cloud desktop tunnel unavailable");
    return new URL("/", tunnel.url).toString();
  }
  async snapshot(computer: ComputerRef, ctx: AdapterContext) {
    const image = await (await this.owned(computer, ctx)).snapshotFilesystem({
      ttlMs: 24 * 60 * 60 * 1000,
    });
    return { id: image.imageId, createdAt: new Date().toISOString() };
  }
  async snapshotWorkspace(computer: ComputerRef, ctx: AdapterContext) {
    const sandbox = await this.owned(computer, ctx);
    if (
      !this.protocols.get(sandbox.sandboxId) ||
      this.images.get(sandbox.sandboxId) !== this.options.imageId
    )
      throw new Error("Computer image update awaits idle restart");
    const snapshot = await this.snapshot(computer, ctx);
    return JSON.stringify({
      imageId: snapshot.id,
      baseImage: this.options.imageId,
      owner: this.owner(computer.botId, ctx),
      expiresAt: Date.now() + 23 * 60 * 60 * 1000,
    });
  }
  async stop(computer: ComputerRef, ctx: AdapterContext) {
    const sandbox = await this.owned(computer, ctx);
    await sandbox.terminate();
    await sandbox.wait();
    this.protocols.delete(sandbox.sandboxId);
    this.images.delete(sandbox.sandboxId);
  }
  async destroy(computer: ComputerRef, ctx: AdapterContext) {
    await this.stop(computer, ctx);
  }
}
