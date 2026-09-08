import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxProvider } from "@rakazo/adapter-kit";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { HostAwareSandbox, sandboxKindForBot } from "./host-aware-sandbox.js";

const ctx = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

describe("host-aware sandbox", () => {
  it("routes offline file access policy by persisted kind even without a machine reference", () => {
    const isolated = new FakeSandboxProvider();
    const host = new DesktopSandboxProvider();
    const policy = vi.fn(() => true);
    const sandbox = new HostAwareSandbox(
      Object.assign(isolated, { requiresRunningForWorkspaceAccess: policy }),
      host,
      async () => true,
    );
    expect(sandbox.requiresRunningForWorkspaceAccess({ kind: "fake" })).toBe(true);
    expect(sandbox.requiresRunningForWorkspaceAccess({ kind: "desktop" })).toBe(false);
    expect(policy).toHaveBeenCalledExactlyOnceWith({ kind: "fake" });
  });

  const hostRoot = mkdtempSync(path.join(tmpdir(), "rakazo-host-root-"));

  afterAll(() => {
    rmSync(hostRoot, { recursive: true, force: true });
  });

  it("lets this-mac cwd run under a host root", async () => {
    const desktop = new DesktopSandboxProvider({ hostRoots: [hostRoot] });
    const computer = await desktop.provision({ botId: "host", homePath: "/tmp/host-home" }, ctx);
    let code = 1;
    for await (const event of desktop.execute(
      computer,
      { argv: ["echo", "ok"], cwd: hostRoot },
      ctx,
    )) {
      if (event.type === "exit") code = event.code;
    }
    expect(code).toBe(0);
    await desktop.destroy(computer, ctx);
  });

  it("still refuses paths outside home and host roots", async () => {
    const desktop = new DesktopSandboxProvider({ hostRoots: [hostRoot] });
    const computer = await desktop.provision({ botId: "deny", homePath: "/tmp/deny" }, ctx);
    let stderr = "";
    let code = 0;
    for await (const event of desktop.execute(
      computer,
      { argv: ["echo", "nope"], cwd: "/etc" },
      ctx,
    )) {
      if (event.type === "stderr") stderr += event.data;
      if (event.type === "exit") code = event.code;
    }
    expect(code).toBe(1);
    expect(stderr).toMatch(/outside this computer's home/i);
    await desktop.destroy(computer, ctx);
  });

  it("provisions on the host provider when enabled", async () => {
    const isolated = new FakeSandboxProvider();
    const host = new DesktopSandboxProvider();
    const sandbox = new HostAwareSandbox(isolated, host, async () => true);
    const computer = await sandbox.provision({ botId: "switch", homePath: "/tmp/switch" }, ctx);
    expect(computer.kind).toBe("desktop");
    await sandbox.destroy(computer, ctx);
  });

  it("provisions on the isolated provider when this-mac is off", async () => {
    const isolated = new FakeSandboxProvider();
    const host = new DesktopSandboxProvider();
    const sandbox = new HostAwareSandbox(isolated, host, async () => false);
    const computer = await sandbox.provision({ botId: "iso", homePath: "/tmp/iso" }, ctx);
    expect(computer.kind).toBe("fake");
    await sandbox.destroy(computer, ctx);
  });

  it("maps the Linux bot home cwd onto the desktop home", async () => {
    const desktop = new DesktopSandboxProvider();
    const computer = await desktop.provision({ botId: "alias", homePath: "/tmp/alias" }, ctx);
    let code = 1;
    for await (const event of desktop.execute(
      computer,
      { argv: ["echo", "ok"], cwd: "/home/rakazo" },
      ctx,
    )) {
      if (event.type === "exit") code = event.code;
    }
    expect(code).toBe(0);
    await desktop.destroy(computer, ctx);
  });

  it("only switches docker deployments onto this Mac", () => {
    expect(sandboxKindForBot("docker", "this-mac")).toBe("desktop");
    expect(sandboxKindForBot("docker", "docker")).toBe("docker");
    expect(sandboxKindForBot("e2b", "this-mac")).toBe("e2b");
    expect(sandboxKindForBot("fake", "this-mac")).toBe("fake");
  });
});

it("keeps live legacy machines on their original provider until their checkpointed ref is cleared", async () => {
  const primary: SandboxProvider = new FakeSandboxProvider();
  const legacy: SandboxProvider = new FakeSandboxProvider();
  vi.spyOn(primary, "describe").mockReturnValue({
    ...primary.describe(),
    id: "fly",
    capabilities: { ...primary.describe().capabilities, persistentRunning: true },
  });
  vi.spyOn(legacy, "describe").mockReturnValue({ ...legacy.describe(), id: "modal" });
  const newProvision = vi.spyOn(primary, "provision");
  const oldProvision = vi.spyOn(legacy, "provision");
  const sandbox = new HostAwareSandbox(primary, legacy, async () => false);
  await sandbox.provision(
    { botId: "home", homePath: "/tmp/home", providerKind: "modal", providerRef: "legacy-ref" },
    ctx,
  );
  expect(oldProvision).toHaveBeenCalledOnce();
  expect(newProvision).not.toHaveBeenCalled();
  await sandbox.provision({ botId: "home", homePath: "/tmp/home", providerKind: "modal" }, ctx);
  expect(newProvision).toHaveBeenCalledOnce();
});

it("uses the existing computer provider's stop durability during migration", async () => {
  const primary = new FakeSandboxProvider();
  const legacy = new FakeSandboxProvider();
  vi.spyOn(primary, "describe").mockReturnValue({ ...primary.describe(), id: "fly" });
  vi.spyOn(legacy, "describe").mockReturnValue({ ...legacy.describe(), id: "modal" });
  const durable = Object.assign(primary, {
    isStoppedWithPersistentWorkspace: vi.fn().mockResolvedValue(true),
  });
  const sandbox = new HostAwareSandbox(durable, legacy, async () => false);
  const ref = { id: "test", providerRef: "test", botId: "home", kind: "modal" as const };
  await expect(sandbox.isStoppedWithPersistentWorkspace(ref, ctx)).resolves.toBe(false);
  expect(durable.isStoppedWithPersistentWorkspace).not.toHaveBeenCalled();
  await expect(
    sandbox.isStoppedWithPersistentWorkspace({ ...ref, kind: "fly" }, ctx),
  ).resolves.toBe(true);
});

it("does not grant shared input to a legacy provider based on the primary capabilities", () => {
  const primary = new FakeSandboxProvider();
  const legacy = new FakeSandboxProvider();
  vi.spyOn(primary, "describe").mockReturnValue({ ...primary.describe(), id: "fly" });
  vi.spyOn(legacy, "describe").mockReturnValue({ ...legacy.describe(), id: "modal" });
  const shared = Object.assign(primary, { supportsSharedInput: vi.fn().mockReturnValue(true) });
  const sandbox = new HostAwareSandbox(shared, legacy, async () => false);
  const ref = { id: "test", providerRef: "test", botId: "home", kind: "modal" as const };
  expect(sandbox.supportsSharedInput(ref)).toBe(false);
  expect(shared.supportsSharedInput).not.toHaveBeenCalled();
  expect(sandbox.supportsSharedInput({ ...ref, kind: "fly" })).toBe(true);
});

it("routes in-place updates to the actual provider and returns unsupported without effects", async () => {
  const primary = new FakeSandboxProvider();
  const legacy = new FakeSandboxProvider();
  vi.spyOn(primary, "describe").mockReturnValue({ ...primary.describe(), id: "fly" });
  vi.spyOn(legacy, "describe").mockReturnValue({ ...legacy.describe(), id: "modal" });
  const ref = { id: "test", providerRef: "test", botId: "home", kind: "fly" as const };
  const updateImage = vi.fn().mockResolvedValue(ref);
  const sandbox = new HostAwareSandbox(
    Object.assign(primary, { updateImage }),
    legacy,
    async () => false,
  );
  expect(await sandbox.updateImage({ ...ref, kind: "modal" }, ctx)).toBeUndefined();
  expect(updateImage).not.toHaveBeenCalled();
  expect(await sandbox.updateImage(ref, ctx)).toEqual(ref);
  expect(updateImage).toHaveBeenCalledOnce();
});
