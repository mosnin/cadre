import { describe, expect, it } from "vitest";
import { type DeviceRequestMessage, MemoryDeviceRelay } from "./device-relay.js";
import { DeviceSandboxProvider } from "./device-sandbox.js";
import { createRunSandbox } from "./host-aware-sandbox.js";

const ctx = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  botId: "bot-1",
  signal: new AbortController().signal,
};
const ref = { id: "device-1", providerRef: "device-1", botId: "bot-1", kind: "device" as const };
const png = Buffer.from("png").toString("base64");

function setup(
  options: { assigned?: boolean; capabilities?: Record<string, unknown>; connected?: boolean } = {},
) {
  const device = {
    id: "device-1",
    userId: "user",
    revokedAt: null as Date | null,
    capabilities: options.capabilities ?? {},
  };
  const prisma: any = {
    device: { findUnique: async ({ where }: any) => (where.id === device.id ? device : null) },
    bot: {
      findFirst: async ({ where }: any) =>
        options.assigned !== false &&
        where.spaceId === "space" &&
        (where.deviceId?.not === null || where.deviceId === "device-1") &&
        (where.id === undefined || where.id === "bot-1") &&
        (where.userId === undefined || where.userId === "user")
          ? { id: "bot-1", deviceId: "device-1", userId: "user" }
          : null,
    },
  };
  const relay = new MemoryDeviceRelay();
  const requests: DeviceRequestMessage[] = [];
  const answers = new Map<string, unknown>();
  const online = relay.attach("device-1", {
    send: (message) => {
      requests.push(message);
      queueMicrotask(() => {
        const answer = answers.get(String(message.request.op));
        void relay.respond("device-1", {
          id: message.id,
          ok: true,
          result: typeof answer === "function" ? answer(message.request) : answer,
        });
      });
    },
    close: () => undefined,
  });
  return {
    prisma,
    relay,
    requests,
    answers,
    device,
    online,
    provider: new DeviceSandboxProvider({ prisma, relay }),
  };
}

describe("DeviceSandboxProvider", () => {
  it("runs exec through the relay with the workspace", async () => {
    const { provider, requests, answers, online } = setup();
    await online;
    answers.set("exec", { stdout: "hi\n", stderr: "", code: 0 });
    const events = [];
    for await (const event of provider.execute(ref, { argv: ["echo", "hi"], timeoutMs: 1000 }, ctx))
      events.push(event);
    expect(events).toEqual([
      { type: "stdout", data: "hi\n" },
      { type: "exit", code: 0 },
    ]);
    expect(requests[0]?.request).toMatchObject({
      op: "exec",
      argv: ["echo", "hi"],
      workspace: "bot-1",
      screenKey: "bot-1",
    });
    expect(requests[0]?.timeoutMs).toBe(16000);
  });

  it("maps observe, actions, files, ax and info to ops", async () => {
    const { provider, requests, answers, online } = setup();
    await online;
    answers.set("observe", { image: png, mimeType: "image/png", width: 10, height: 5 });
    answers.set("actions", { completed: 1 });
    answers.set("list", [{ path: "a.txt", kind: "file", size: 1, executable: false }]);
    answers.set("read", { content: Buffer.from("data").toString("base64") });
    answers.set("write", { ok: true });
    answers.set("ax", { content: [{ type: "text", text: "tree" }] });
    answers.set("info", { platform: "macos", version: "1", displays: [], capabilities: {} });

    const observation = await provider.observe(ref, ctx);
    expect(observation).toMatchObject({ width: 10, height: 5 });
    await provider.act(ref, { actions: [{ kind: "wait", ms: 1 }] }, ctx);
    expect(await provider.listFiles(ref, "", ctx)).toHaveLength(1);
    expect((await provider.readFile(ref, "a.txt", ctx)).toString()).toBe("data");
    await provider.writeFile(ref, { path: "b.txt", content: Buffer.from("x") }, ctx);
    expect(await provider.accessibility(ref, { tool: "list_apps" }, ctx)).toEqual({
      content: [{ type: "text", text: "tree" }],
    });
    await provider.info(ref, ctx);
    expect(requests.map((r) => r.request.op)).toEqual([
      "observe",
      "actions",
      "list",
      "read",
      "write",
      "ax",
      "info",
    ]);
    expect(requests[5]?.request).toMatchObject({ op: "ax", tool: "list_apps", args: {} });
  });

  it("sends browser requests with protected text in the body", async () => {
    const { provider, requests, answers, online } = setup();
    await online;
    answers.set("browser", { ok: true });
    await provider.browser(
      ref,
      { action: "fill_protected", ref: "e1", secretText: "hunter2" },
      ctx,
    );
    expect(requests[0]?.request).toMatchObject({
      op: "browser",
      action: "fill_protected",
      secretText: "hunter2",
    });
  });

  it("serves screens as snapshots", async () => {
    const { provider, answers, online } = setup();
    await online;
    answers.set("observe", { image: png, mimeType: "image/png", width: 1, height: 1 });
    answers.set("screen", { ok: true });
    const screen = await provider.connectScreen(ref, { view: "stream" }, ctx);
    expect(screen.mimeType).toBe("image/png");
    expect(screen.url).toMatch(/^data:image\/png;base64,/);
  });

  it("fails with a not-found error when the device is offline", async () => {
    const { prisma } = setup();
    const provider = new DeviceSandboxProvider({ prisma, relay: new MemoryDeviceRelay() });
    await expect(provider.observe(ref, ctx)).rejects.toMatchObject({
      name: "SandboxNotFoundError",
      message: "Device is offline",
    });
    await expect(provider.prepare(ref, ctx)).rejects.toMatchObject({
      name: "SandboxNotFoundError",
    });
    prisma.device.findUnique = async () => null;
    await expect(provider.observe(ref, ctx)).rejects.toMatchObject({
      name: "SandboxNotFoundError",
    });
  });

  it("rejects computers outside the assigned bot's space and foreign kinds", async () => {
    const { provider, online } = setup();
    await online;
    await expect(provider.observe(ref, { ...ctx, spaceId: "other" })).rejects.toThrow(
      "Computer access denied",
    );
    await expect(provider.observe({ ...ref, kind: "fly" }, ctx)).rejects.toThrow(
      "Incorrect computer provider",
    );
    const unassigned = setup({ assigned: false });
    await unassigned.online;
    await expect(unassigned.provider.observe(ref, ctx)).rejects.toThrow("Computer access denied");
  });

  it("provisions the bot's assigned device and explains when none is assigned", async () => {
    const { provider } = setup();
    expect(await provider.provision({ botId: "bot-1", homePath: "/tmp/home" }, ctx)).toMatchObject({
      kind: "device",
      providerRef: "device-1",
      botId: "bot-1",
    });
    const none = setup({ assigned: false });
    await expect(
      none.provider.provision({ botId: "bot-1", homePath: "/tmp/home" }, ctx),
    ).rejects.toThrow("Assign a device to this bot in Burst");
    await expect(none.provider.snapshot()).rejects.toThrow("snapshots");
    await expect(none.provider.stop()).resolves.toBeUndefined();
  });

  it("uses the device for assigned bots under any default provider", async () => {
    const { prisma, relay } = setup();
    const sandbox = createRunSandbox("fake", { device: { prisma, relay } });
    expect(await sandbox.provision({ botId: "bot-1", homePath: "/tmp/home" }, ctx)).toMatchObject({
      kind: "device",
    });
    expect(
      await sandbox.provision(
        { botId: "bot-2", homePath: "/tmp/home" },
        { ...ctx, botId: "bot-2" },
      ),
    ).toMatchObject({ kind: "fake" });
  });
});
