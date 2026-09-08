import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  AdapterContext,
  BrowserRequest,
  CommandRequest,
  ComputerAction,
  ComputerActionRequest,
  ComputerFileEntry,
  ComputerInput,
  ComputerRef,
  ControlLeaseRef,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
} from "@rakazo/adapter-kit";
import { screenSessionKey } from "./computer-screens.js";
import { boundedComputerActions, computerObservation } from "./computer-support.js";
import { shouldSkipPortableWorkspaceFile } from "./computer-workspace.js";

type Frame = { image: string; mimeType: "image/png"; width: number; height: number };
const frame = (value: Frame) => computerObservation(Buffer.from(value.image, "base64"), value);

function stoppedComputer(): Error {
  const error = new Error("Cloud computer has stopped");
  error.name = "SandboxNotFoundError";
  return error;
}

/** Shared Linux desktop protocol; each adapter owns its provider and tenant boundary. */
export abstract class LinuxDesktopSandbox<Handle> implements SandboxProvider {
  protected abstract owned(computer: ComputerRef, ctx: AdapterContext): Promise<Handle>;
  protected abstract rpc<T>(
    handle: Handle,
    request: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
  protected abstract alive(handle: Handle): Promise<boolean>;
  protected abstract multiscreen(handle: Handle): boolean;
  protected abstract screenEndpoint(handle: Handle): Promise<string>;
  protected abstract viewToken(homeKey: string, ctx: AdapterContext): string;
  abstract describe(): ReturnType<SandboxProvider["describe"]>;
  abstract provision(
    request: Parameters<SandboxProvider["provision"]>[0],
    ctx: AdapterContext,
  ): Promise<ComputerRef>;
  abstract snapshot(
    computer: ComputerRef,
    ctx: AdapterContext,
  ): ReturnType<SandboxProvider["snapshot"]>;
  abstract stop(computer: ComputerRef, ctx: AdapterContext): Promise<void>;
  abstract destroy(computer: ComputerRef, ctx: AdapterContext): Promise<void>;
  async prepare(computer: ComputerRef, ctx: AdapterContext) {
    if (!(await this.alive(await this.owned(computer, ctx)))) throw stoppedComputer();
    for await (const event of this.execute(
      computer,
      {
        argv: [
          "bash",
          "-lc",
          "for i in {1..100}; do xdpyinfo -display :1 >/dev/null 2>&1 && python3 -c 'import urllib.request; urllib.request.urlopen(\"http://127.0.0.1:8080/embed.html\", timeout=1).read(1)' >/dev/null 2>&1 && exit 0; sleep 0.2; done; exit 1",
        ],
        timeoutMs: 25000,
      },
      { ...ctx, botId: undefined, screenLeaseId: undefined },
    )) {
      if (event.type === "exit" && event.code !== 0)
        throw new Error("Cloud desktop did not become ready");
    }
  }
  async *execute(
    computer: ComputerRef,
    request: CommandRequest,
    ctx: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    ctx.signal.throwIfAborted();
    if (request.pty) throw new Error("Cloud computer does not support PTY sessions");
    const sandbox = await this.owned(computer, ctx);
    const operationId = randomUUID();
    const timeoutMs = Math.min(Math.max(request.timeoutMs ?? 300000, 1), 3600000);
    let cancellation: Promise<unknown> | undefined;
    const cancel = () => {
      cancellation = this.rpc(sandbox, { op: "cancel", operationId }).catch(() => undefined);
    };
    ctx.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (ctx.signal.aborted) cancel();
      const result = await this.rpc<{ stdout: string; stderr: string; code: number }>(
        sandbox,
        {
          ...request,
          op: "exec",
          operationId,
          timeoutMs,
          screenKey: ctx.botId,
          screenLease: ctx.screenLeaseId,
        },
        timeoutMs + 15000,
      );
      ctx.signal.throwIfAborted();
      if (result.stdout) yield { type: "stdout", data: result.stdout };
      if (result.stderr) yield { type: "stderr", data: result.stderr };
      yield { type: "exit", code: result.code };
    } finally {
      ctx.signal.removeEventListener("abort", cancel);
      await cancellation;
    }
  }
  async browser(computer: ComputerRef, request: BrowserRequest, context: AdapterContext) {
    const source = await readFile(new URL("./visible-browser.py", import.meta.url), "utf8");
    let output = "";
    for await (const event of this.execute(
      computer,
      {
        argv: ["python3", "-c", source, JSON.stringify(request)],
        timeoutMs: 20000,
      },
      context,
    )) {
      if (event.type === "stdout") output += event.data;
      if (event.type === "exit" && event.code !== 0)
        throw new Error("Structured browser control is unavailable.");
      if (output.length > 150000) throw new Error("Browser snapshot exceeded its size limit.");
    }
    return JSON.parse(output) as Record<string, unknown>;
  }
  supportsSharedInput(_computer: ComputerRef) {
    return this.describe().capabilities.sharedInput === true;
  }
  async connectScreen(computer: ComputerRef, request: ScreenRequest, ctx: AdapterContext) {
    if (request.view === "snapshot") {
      const observation = await this.observe(computer, ctx);
      return {
        url: `data:image/png;base64,${Buffer.from(observation.image).toString("base64")}`,
        mimeType: "image/png",
        close: async () => {},
      };
    }
    const sandbox = await this.owned(computer, ctx);
    if (!(await this.alive(sandbox))) throw stoppedComputer();
    const requestSharedInput = Boolean(request.sharedInput && this.supportsSharedInput(computer));
    if (request.sharedInput && !requestSharedInput)
      throw new Error("Shared computer input is unavailable");
    const screen = this.multiscreen(sandbox)
      ? await this.rpc<{ key: string; sharedUntil?: number }>(sandbox, {
          op: "resolveScreen",
          screenKey: screenSessionKey(ctx),
          ...(requestSharedInput ? { sharedInput: true } : {}),
        })
      : undefined;
    // Persistent machines may still run the preceding image. Negotiate from
    // the runtime response; an older image remains view-only until upgraded.
    const sharedInput =
      requestSharedInput &&
      typeof screen?.sharedUntil === "number" &&
      Number.isSafeInteger(screen.sharedUntil) &&
      screen.sharedUntil > Date.now() / 1000;
    if (request.interactive && !sharedInput)
      await this.setScreenControl(computer, true, ctx, request.controlToken);
    const url = new URL("embed.html", await this.screenEndpoint(sandbox));
    url.searchParams.set("view_only", request.interactive || sharedInput ? "false" : "true");
    if (sharedInput) url.searchParams.set("shared_until", String(screen!.sharedUntil));
    if (screen) url.searchParams.set("screen", screen.key);
    url.searchParams.set(
      "cadre_token",
      sharedInput
        ? createHmac("sha256", this.viewToken(computer.botId, ctx))
            .update(`shared:${screen!.key}:${screen!.sharedUntil}`)
            .digest("hex")
        : request.interactive
          ? request.controlToken!
          : screen
            ? createHmac("sha256", this.viewToken(computer.botId, ctx))
                .update(screen.key)
                .digest("hex")
            : this.viewToken(computer.botId, ctx),
    );
    return {
      sharedInput,
      url: url.toString(),
      mimeType: "text/html",
      close: async () => {
        if (request.interactive && !sharedInput)
          await this.setScreenControl(computer, false, ctx, request.controlToken);
      },
    };
  }
  async sendSharedInput(computer: ComputerRef, action: ComputerAction, ctx: AdapterContext) {
    if (!this.supportsSharedInput(computer))
      throw new Error("Shared computer input is unavailable");
    await this.rpc(await this.owned(computer, ctx), {
      op: "sharedInput",
      screenKey: screenSessionKey(ctx),
      actions: [action],
    });
  }
  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    ctx: AdapterContext,
    controlToken?: string,
  ) {
    if (interactive && !controlToken) throw new Error("Control lease required");
    await this.rpc(await this.owned(computer, ctx), {
      op: "screen",
      interactive,
      leaseId: controlToken ?? ctx.screenLeaseId,
      controlToken,
      screenKey: screenSessionKey(ctx),
    });
  }
  async releaseScreen(computer: ComputerRef, ctx: AdapterContext) {
    await this.setScreenControl(computer, false, ctx);
    const sandbox = await this.owned(computer, ctx);
    if (!this.multiscreen(sandbox)) return;
    await this.rpc(sandbox, {
      op: "releaseScreen",
      screenKey: screenSessionKey(ctx),
      screenLease: ctx.screenLeaseId,
    });
  }
  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    ctx: AdapterContext,
  ) {
    if (lease.holder !== "user" || lease.leaseId !== ctx.screenLeaseId)
      throw new Error("Control lease required");
    await this.rpc(await this.owned(computer, ctx), {
      op: "input",
      actions: [input],
      leaseId: lease.leaseId,
      screenKey: screenSessionKey(ctx),
    });
  }
  async observe(computer: ComputerRef, ctx: AdapterContext) {
    return frame(
      await this.rpc<Frame>(await this.owned(computer, ctx), {
        op: "observe",
        screenKey: screenSessionKey(ctx),
        screenLease: ctx.screenLeaseId,
      }),
    );
  }
  async act(computer: ComputerRef, request: ComputerActionRequest, ctx: AdapterContext) {
    const result = await this.rpc<{ completed: number; observation?: Frame }>(
      await this.owned(computer, ctx),
      {
        ...request,
        actions: boundedComputerActions(request.actions),
        op: "actions",
        screenKey: screenSessionKey(ctx),
        screenLease: ctx.screenLeaseId,
      },
      60000,
    );
    return {
      completed: result.completed,
      observation: result.observation ? frame(result.observation) : undefined,
    };
  }
  async listFiles(computer: ComputerRef, path: string, ctx: AdapterContext) {
    return this.rpc<ComputerFileEntry[]>(await this.owned(computer, ctx), { op: "list", path });
  }
  async readFile(
    computer: ComputerRef,
    path: string,
    ctx: AdapterContext,
    options?: { maxBytes?: number },
  ) {
    const result = await this.rpc<{ content: string }>(await this.owned(computer, ctx), {
      op: "read",
      path,
      ...options,
    });
    return Buffer.from(result.content, "base64");
  }
  async writeFile(computer: ComputerRef, file: PortableFile, ctx: AdapterContext) {
    await this.rpc(await this.owned(computer, ctx), {
      op: "write",
      path: file.path,
      executable: file.executable,
      content: Buffer.from(file.content).toString("base64"),
    });
  }
  async *exportWorkspace(computer: ComputerRef, ctx: AdapterContext): AsyncIterable<PortableFile> {
    const sandbox = await this.owned(computer, ctx);
    if (!this.multiscreen(sandbox)) {
      const pending = [""];
      let count = 0;
      let bytes = 0;
      while (pending.length) {
        ctx.signal.throwIfAborted();
        for (const entry of await this.rpc<ComputerFileEntry[]>(sandbox, {
          op: "list",
          path: pending.pop()!,
        })) {
          if (shouldSkipPortableWorkspaceFile(entry.path)) continue;
          if (++count > 10000) throw new Error("Workspace contains too many files");
          if (entry.kind === "dir") {
            pending.push(entry.path);
            continue;
          }
          bytes += entry.size;
          if (bytes > 512 * 1024 * 1024) throw new Error("Workspace exceeds transfer limit");
          const result = await this.rpc<{ content: string }>(sandbox, {
            op: "read",
            path: entry.path,
          });
          yield {
            path: entry.path,
            executable: entry.executable,
            content: Buffer.from(result.content, "base64"),
          };
        }
      }
      return;
    }
    const files = (await this.rpc<ComputerFileEntry[]>(sandbox, { op: "manifest" })).filter(
      (entry) => !shouldSkipPortableWorkspaceFile(entry.path),
    );
    // Bound both RPC concurrency and the bytes held before yielding to the home store.
    while (files.length) {
      ctx.signal.throwIfAborted();
      const batch = [files.shift()!];
      let bytes = batch[0]!.size;
      while (files.length && batch.length < 8 && bytes + files[0]!.size <= 8 * 1024 * 1024) {
        const entry = files.shift()!;
        batch.push(entry);
        bytes += entry.size;
      }
      const contents = await this.rpc<Array<{ content: string }>>(sandbox, {
        op: "readBatch",
        paths: batch.map((entry) => entry.path),
      });
      if (contents.length !== batch.length) throw new Error("Incomplete workspace batch");
      for (const [index, entry] of batch.entries())
        yield {
          path: entry.path,
          executable: entry.executable,
          content: Buffer.from(contents[index]!.content, "base64"),
        };
    }
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    ctx: AdapterContext,
  ) {
    const sandbox = await this.owned(computer, ctx);
    if (!this.multiscreen(sandbox)) {
      for await (const file of files) {
        ctx.signal.throwIfAborted();
        await this.rpc(sandbox, {
          op: "write",
          path: file.path,
          executable: file.executable,
          content: Buffer.from(file.content).toString("base64"),
        });
      }
      return;
    }
    await this.rpc(sandbox, { op: "restoreBegin" });
    try {
      let batch: Array<{ path: string; executable?: boolean; content: string }> = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await this.rpc(sandbox, { op: "writeBatch", files: batch });
        batch = [];
        bytes = 0;
      };
      for await (const file of files) {
        ctx.signal.throwIfAborted();
        if (batch.length && (batch.length >= 8 || bytes + file.content.length > 8 * 1024 * 1024))
          await flush();
        bytes += file.content.length;
        batch.push({
          path: file.path,
          executable: file.executable,
          content: Buffer.from(file.content).toString("base64"),
        });
      }
      await flush();
    } finally {
      await this.rpc(sandbox, { op: "restoreEnd" });
    }
  }
}
