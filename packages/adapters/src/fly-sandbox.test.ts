import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FlySandboxProvider } from "./fly-sandbox.js";

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};
const owner = createHash("sha256")
  .update(JSON.stringify([context.spaceId, "home"]))
  .digest("hex");
const machine = {
  id: "1234567890abcd",
  state: "started",
  config: {
    metadata: { cadre_owner: owner },
    mounts: [{ path: "/home/rakazo", volume: "vol_test" }],
  },
};
const ref = {
  id: machine.id,
  providerRef: machine.id,
  kind: "fly" as const,
  botId: "home",
};
const options = {
  appName: "computer-test",
  apiToken: "test-api-token",
  image: "registry.example/computer:v1",
  screenSecret: "test-secret-with-at-least-32-characters",
};
const json = (body: unknown) => new Response(JSON.stringify(body));

describe("persistent Fly computers", () => {
  it("does not resume services after an expired workspace import", async () => {
    const controller = new AbortController();
    const operations: string[] = [];
    let started!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes("api.machines.dev")) return json(machine);
      const body = JSON.parse(String(init?.body));
      operations.push(body.op);
      if (body.op !== "writeBatch") return json({ ok: true });
      const signal = init?.signal as AbortSignal;
      started();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    const provider = new FlySandboxProvider(options, request);
    async function* files() {
      yield { path: "result.txt", content: Buffer.from("owned workspace") };
    }
    const rejected = expect(
      provider.importWorkspace(ref, files(), { ...context, signal: controller.signal }),
    ).rejects.toThrow("startup expired");
    await writing;
    controller.abort(new Error("startup expired"));
    await rejected;
    expect(operations).toEqual(["restoreBegin", "writeBatch"]);
  });
  it("aborts a stalled command request and sends one bounded remote cancellation", async () => {
    const controller = new AbortController();
    let commandSignal: AbortSignal | undefined;
    let commandStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commandStarted = resolve;
    });
    const requests: Record<string, unknown>[] = [];
    const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes("api.machines.dev")) return json(machine);
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (body.op === "cancel") return json({ ok: true });
      commandSignal = init?.signal as AbortSignal;
      commandStarted();
      return new Promise<Response>((_resolve, reject) => {
        commandSignal!.addEventListener("abort", () => reject(commandSignal!.reason), {
          once: true,
        });
      });
    });
    const provider = new FlySandboxProvider(options, request);
    const execution = (async () => {
      for await (const _event of provider.execute(
        ref,
        { argv: ["sleep", "300"] },
        {
          ...context,
          signal: controller.signal,
        },
      )) {
        /* consume command events */
      }
    })();
    const rejection = expect(execution).rejects.toThrow("startup expired");
    await started;
    controller.abort(new Error("startup expired"));
    await rejection;
    expect(commandSignal?.aborted).toBe(true);
    expect(requests.map((entry) => entry.op)).toEqual(["exec", "cancel"]);
    expect(requests[1]?.operationId).toBe(requests[0]?.operationId);
  });
  it("reuses the same running machine without creating or restarting resources", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
    const provider = new FlySandboxProvider(options, request);
    const result = await provider.provision(
      {
        botId: "home",
        homePath: "/workspace",
        providerKind: "fly",
        providerRef: machine.id,
      },
      context,
    );
    expect(result).toMatchObject({
      ...ref,
      fresh: false,
      workspaceRestored: true,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(provider.suspendWhenIdle()).toBe(false);
  });
  it("rejects cross-team references before issuing any desktop command", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
    const provider = new FlySandboxProvider(options, request);
    await expect(
      provider.connectScreen(ref, { view: "stream" }, { ...context, spaceId: "other-space" }),
    ).rejects.toThrow("Computer access denied");
    expect(request).toHaveBeenCalledOnce();
  });
  it("creates an encrypted home disk and a VM with automatic idle shutdown disabled", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: "vol_test" }))
      .mockResolvedValueOnce(json(machine));
    const provider = new FlySandboxProvider(options, request);
    await provider.provision({ botId: "home", homePath: "/workspace" }, context);
    const disk = JSON.parse(String(request.mock.calls[2]![1]!.body));
    const vm = JSON.parse(String(request.mock.calls[3]![1]!.body));
    expect(disk).toMatchObject({ encrypted: true, size_gb: 10 });
    expect(vm.config).toMatchObject({
      mounts: [{ volume: "vol_test", path: "/home/rakazo" }],
      restart: { policy: "always" },
      services: [{ autostop: "off", autostart: false }],
    });
    expect(vm.config.env).not.toHaveProperty("FLY_API_TOKEN");
    expect(vm.config.env.CADRE_RPC_TOKEN).not.toBe(vm.config.env.CADRE_SCREEN_VIEW_TOKEN);
  });
  it("stops a machine explicitly without deleting its persistent disk", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(machine))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new FlySandboxProvider(options, request);
    await provider.stop(ref, context);
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining(`/machines/${machine.id}`),
      expect.stringContaining(`/machines/${machine.id}/stop`),
      expect.stringContaining(`/machines/${machine.id}/wait?state=stopped`),
    ]);
    expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("replaces deleted disk records after a failed migration rolls back", async () => {
    const name = `home_${owner.slice(0, 24)}`;
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(
        json([
          { id: "vol_old", name, state: "pending_destroy" },
          { id: "vol_deleted", name, state: "destroyed" },
        ]),
      )
      .mockResolvedValueOnce(json({ id: "vol_new", name, state: "created" }))
      .mockResolvedValueOnce(json(machine));
    const result = await new FlySandboxProvider(options, request).provision(
      { botId: "home", homePath: "/workspace" },
      context,
    );
    expect(result.fresh).toBe(true);
    const vm = JSON.parse(String(request.mock.calls[3]![1]!.body));
    expect(vm.config.mounts).toEqual([{ volume: "vol_new", path: "/home/rakazo" }]);
  });
  it("does not replace an existing disk that is still becoming ready", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(
        json([
          {
            id: "vol_wait",
            name: `home_${owner.slice(0, 24)}`,
            state: "hydrating",
          },
        ]),
      );
    await expect(
      new FlySandboxProvider(options, request).provision(
        { botId: "home", homePath: "/workspace" },
        context,
      ),
    ).rejects.toThrow("Workspace disk is not ready");
    expect(request).toHaveBeenCalledTimes(2);
  });
});

it("waits for the provider backup to contain durable data before reporting a snapshot", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ Msg: { backup: { graph_id: "vs_test" } } }))
    .mockResolvedValueOnce(
      json([
        {
          id: "vs_test",
          digest: "backup-digest",
          size: 1024,
          created_at: "2026-09-06T00:00:00Z",
        },
      ]),
    );
  await expect(new FlySandboxProvider(options, request).snapshot(ref, context)).resolves.toEqual({
    id: "vs_test",
    createdAt: "2026-09-06T00:00:00Z",
  });
});

it("only skips a checkpoint for an already stopped owned computer with a durable home", async () => {
  for (const state of ["started", "stopped"]) {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ ...machine, state }));
    await expect(
      new FlySandboxProvider(options, request).isStoppedWithPersistentWorkspace(ref, context),
    ).resolves.toBe(state === "stopped");
    expect(request).toHaveBeenCalledOnce();
  }
  const missingMount = vi
    .fn<typeof fetch>()
    .mockResolvedValue(json({ ...machine, config: { ...machine.config, mounts: [] } }));
  await expect(
    new FlySandboxProvider(options, missingMount).isStoppedWithPersistentWorkspace(ref, context),
  ).resolves.toBe(false);
  const wrongOwner = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
  await expect(
    new FlySandboxProvider(options, wrongOwner).isStoppedWithPersistentWorkspace(ref, {
      ...context,
      spaceId: "other",
    }),
  ).rejects.toThrow("Computer access denied");
});

it("accepts a repeated stop without contacting an already stopped desktop", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(json({ ...machine, state: "stopped" }));
  await new FlySandboxProvider(options, request).stop(ref, context);
  expect(request).toHaveBeenCalledOnce();
});

it("flushes and pauses browsers before a stop checkpoint and can restore them on failure", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ ok: true }))
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ ok: true }));
  const resume = await new FlySandboxProvider(options, request).pauseWorkspaceForStop(ref, context);
  expect(JSON.parse(String(request.mock.calls[1]![1]?.body))).toEqual({
    op: "restoreBegin",
  });
  await resume();
  expect(JSON.parse(String(request.mock.calls[3]![1]?.body))).toEqual({
    op: "restoreEnd",
  });
});

it("runs structured browser actions through the owned bot screen without shell interpolation", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ stdout: '{"title":"Form","elements":[]}', stderr: "", code: 0 }));
  const provider = new FlySandboxProvider(options, request);
  const input = {
    action: "fill" as const,
    snapshotId: "s",
    ref: "e1",
    text: "$(not-a-command) `literal`",
  };
  await expect(
    provider.browser(ref, input, {
      ...context,
      botId: "bot",
      screenLeaseId: "run:1",
    }),
  ).resolves.toEqual({ title: "Form", elements: [] });
  const payload = JSON.parse(String(request.mock.calls[1]![1]!.body));
  expect(payload.screenKey).toBe("bot");
  expect(payload.screenLease).toBe("run:1");
  expect(payload.argv.slice(0, 2)).toEqual(["python3", "-c"]);
  expect(JSON.parse(payload.argv[3])).toEqual(input);
});

it("denies cross-team browser actions before executing their helper", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json(machine));
  const provider = new FlySandboxProvider(options, request);
  await expect(
    provider.browser(ref, { action: "snapshot" }, { ...context, spaceId: "another" }),
  ).rejects.toThrow("Computer access denied");
  expect(request).toHaveBeenCalledOnce();
});

it("flushes the mounted home volume before acknowledging task persistence", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ stdout: "", stderr: "", code: 0 }));
  const provider = new FlySandboxProvider(options, request);
  await expect(
    provider.persistWorkspace(ref, { ...context, botId: "paused-bot", screenLeaseId: "run:9" }),
  ).resolves.toBe(true);
  const flush = JSON.parse(String(request.mock.calls[2]![1]!.body));
  expect(flush).toMatchObject({
    op: "exec",
    argv: ["sync", "-f", "/home/rakazo"],
  });
  expect(flush.screenKey).toBeUndefined();
  expect(flush.screenLease).toBeUndefined();
});

it("does not claim persistence when the machine has no home volume", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...machine, config: { metadata: machine.config.metadata } }));
  await expect(
    new FlySandboxProvider(options, request).persistWorkspace(ref, context),
  ).resolves.toBe(false);
  expect(request).toHaveBeenCalledOnce();
});

it("signs a separate expiring shared viewer without taking control of the agent", async () => {
  const key = createHash("sha256").update("agent").digest("hex");
  const calls: Array<Record<string, unknown>> = [];
  const request = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    if (!init?.body) return json(machine);
    const body = JSON.parse(String(init.body));
    calls.push(body);
    return json({ key, sharedUntil: 2_000_000_000 });
  });
  const provider = new FlySandboxProvider(options, request);
  const session = await provider.connectScreen(
    ref,
    { view: "stream", sharedInput: true },
    { ...context, botId: "agent" },
  );
  const url = new URL(session.url!);
  expect(url.searchParams.get("view_only")).toBe("false");
  expect(url.searchParams.get("screen")).toBe(key);
  expect(url.searchParams.get("shared_until")).toBe("2000000000");
  expect(url.searchParams.get("cadre_token")).toMatch(/^[a-f0-9]{64}$/);
  await session.close();
  expect(calls).toEqual([{ op: "resolveScreen", screenKey: "agent", sharedInput: true }]);
  const view = await provider.connectScreen(
    ref,
    { view: "stream" },
    { ...context, botId: "agent" },
  );
  expect(new URL(view.url!).searchParams.get("cadre_token")).not.toBe(
    url.searchParams.get("cadre_token"),
  );
});

it("keeps older persistent images view-only until their runtime supports shared input", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) =>
      init?.body ? json({ key: "screen-key" }) : json(machine),
    );
  const provider = new FlySandboxProvider(options, request);
  const session = await provider.connectScreen(
    ref,
    { view: "stream", sharedInput: true },
    { ...context, botId: "agent" },
  );
  expect(session.sharedInput).toBe(false);
  const url = new URL(session.url!);
  expect(url.searchParams.get("view_only")).toBe("true");
  expect(url.searchParams.has("shared_until")).toBe(false);
  await session.close();
  expect(request).toHaveBeenCalledTimes(2);
});

it("updates the owned machine image without changing any other config or volume", async () => {
  const original = {
    ...machine,
    instance_id: "version-old",
    config: {
      ...machine.config,
      image: "registry.example/old",
      env: { KEEP: "test-value" },
      services: [{ internal_port: 8080 }],
      restart: { policy: "always" },
      custom: { preserved: true },
    },
  };
  const changed = {
    ...original,
    instance_id: "version-new",
    config: { ...original.config, image: options.image },
  };
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(original))
    .mockResolvedValueOnce(json(changed))
    .mockResolvedValueOnce(json({ ok: true }))
    .mockResolvedValueOnce(json(changed));
  const result = await new FlySandboxProvider(options, request).updateImage(ref, context);
  expect(result).toMatchObject({
    ...ref,
    fresh: false,
    workspaceRestored: true,
  });
  expect(JSON.parse(String(request.mock.calls[1]![1]!.body))).toEqual({
    config: changed.config,
    current_version: "version-old",
  });
  expect(String(request.mock.calls[1]![0])).toContain(`/machines/${machine.id}`);
  expect(String(request.mock.calls[2]![0])).toContain("instance_id=version-new");
  expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it("rejects cross-team image updates before issuing a write", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
  await expect(
    new FlySandboxProvider(options, request).updateImage(ref, {
      ...context,
      spaceId: "other",
    }),
  ).rejects.toThrow("Computer access denied");
  expect(request).toHaveBeenCalledOnce();
});

it("does not destroy or create resources after an image update failure", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...machine, instance_id: "version-old" }))
    .mockResolvedValueOnce(new Response("failed", { status: 400 }));
  await expect(new FlySandboxProvider(options, request).updateImage(ref, context)).rejects.toThrow(
    "400",
  );
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});

it("excludes a disk already scheduled for destruction from replacement allocation", async () => {
  const name = `home_${owner.slice(0, 24)}`;
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json([]))
    .mockResolvedValueOnce(
      json([
        {
          id: "vol_old",
          name,
          state: "scheduling_destroy",
          attached_machine_id: null,
        },
      ]),
    )
    .mockResolvedValueOnce(json({ id: "vol_new", name, state: "created" }))
    .mockResolvedValueOnce(json(machine));
  await new FlySandboxProvider(options, request).provision(
    { botId: "home", homePath: "/tmp/home" },
    context,
  );
  expect(JSON.parse(String(request.mock.calls[3]![1]!.body)).config.mounts).toEqual([
    { volume: "vol_new", path: "/home/rakazo" },
  ]);
});

it("rejects image updates without a current version before writing", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
  await expect(new FlySandboxProvider(options, request).updateImage(ref, context)).rejects.toThrow(
    "version is unavailable",
  );
  expect(request).toHaveBeenCalledOnce();
});

it("rejects an update response without a version instead of waiting for any instance", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...machine, instance_id: "version-old" }))
    .mockResolvedValueOnce(json(machine));
  await expect(new FlySandboxProvider(options, request).updateImage(ref, context)).rejects.toThrow(
    "updated version is unavailable",
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it("rejects readiness from a different machine version", async () => {
  const changed = {
    ...machine,
    instance_id: "version-new",
    config: { ...machine.config, image: options.image },
  };
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ ...machine, instance_id: "version-old" }))
    .mockResolvedValueOnce(json(changed))
    .mockResolvedValueOnce(json({}))
    .mockResolvedValueOnce(json({ ...changed, instance_id: "version-unexpected" }));
  await expect(new FlySandboxProvider(options, request).updateImage(ref, context)).rejects.toThrow(
    "could not be verified",
  );
  expect(request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});
