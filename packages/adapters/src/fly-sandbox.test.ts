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
const ref = { id: machine.id, providerRef: machine.id, kind: "fly" as const, botId: "home" };
const options = {
  appName: "computer-test",
  apiToken: "test-api-token",
  image: "registry.example/computer:v1",
  screenSecret: "test-secret-with-at-least-32-characters",
};
const json = (body: unknown) => new Response(JSON.stringify(body));

describe("persistent Fly computers", () => {
  it("reuses the same running machine without creating or restarting resources", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(machine));
    const provider = new FlySandboxProvider(options, request);
    const result = await provider.provision(
      { botId: "home", homePath: "/workspace", providerKind: "fly", providerRef: machine.id },
      context,
    );
    expect(result).toMatchObject({ ...ref, fresh: false, workspaceRestored: true });
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
});

it("waits for the provider backup to contain durable data before reporting a snapshot", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json(machine))
    .mockResolvedValueOnce(json({ Msg: { backup: { graph_id: "vs_test" } } }))
    .mockResolvedValueOnce(
      json([
        { id: "vs_test", digest: "backup-digest", size: 1024, created_at: "2026-09-06T00:00:00Z" },
      ]),
    );
  await expect(new FlySandboxProvider(options, request).snapshot(ref, context)).resolves.toEqual({
    id: "vs_test",
    createdAt: "2026-09-06T00:00:00Z",
  });
});
