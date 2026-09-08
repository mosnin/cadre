import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceComputer } from "./computer-lifecycle.js";
import { checkpointAndRecordComputerWorkspace } from "./computer-workspace.js";

vi.mock("./computer-workspace.js", async (original) => ({
  ...(await original<typeof import("./computer-workspace.js")>()),
  checkpointAndRecordComputerWorkspace: vi.fn().mockResolvedValue("checkpoint"),
  restoreComputerWorkspace: vi.fn().mockResolvedValue(undefined),
  ensureComputerWorkspaceLayout: vi.fn().mockResolvedValue(undefined),
}));
const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};
function harness() {
  const row = {
    id: "computer",
    homeKey: "home",
    providerRef: "machine",
    kind: "fly",
    scope: "team",
    state: "running",
    controlHolder: "none",
    controlLeaseId: null,
  };
  const ref = {
    id: "machine",
    providerRef: "machine",
    botId: "home",
    kind: "fly" as const,
    fresh: false,
    workspaceRestored: true,
  };
  const updateMany = vi.fn().mockImplementation(async ({ data }) => {
    Object.assign(row, data);
    return { count: 1 };
  });
  const update = vi.fn().mockImplementation(async ({ data }) => {
    Object.assign(row, data);
    return row;
  });
  const resume = vi.fn().mockResolvedValue(undefined);
  const sandbox = {
    describe: () => ({ id: "fly", capabilities: { persistentRunning: true } }),
    pauseWorkspaceForStop: vi.fn().mockResolvedValue(resume),
    persistWorkspace: vi.fn().mockResolvedValue(true),
    isStoppedWithPersistentWorkspace: vi.fn().mockResolvedValue(false),
    updateImage: vi.fn().mockResolvedValue(ref),
    prepare: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    releaseScreen: vi.fn().mockResolvedValue(undefined),
    provision: vi.fn().mockResolvedValue({ ...ref, providerRef: "replacement", fresh: true }),
  };
  const deps = {
    prisma: {
      computer: {
        findUniqueOrThrow: vi.fn().mockImplementation(async () => ({ ...row })),
        updateMany,
        update,
      },
      run: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    sandbox,
    home: {},
    jobs: {},
    events: {},
  };
  const replace = (dataDir?: string) =>
    replaceComputer(
      { ...deps, dataDir } as unknown as Parameters<typeof replaceComputer>[0],
      "computer",
      "update",
      context,
    );
  return { row, ref, deps, sandbox, resume, replace };
}
describe("in-place computer updates", () => {
  beforeEach(() => {
    vi.mocked(checkpointAndRecordComputerWorkspace).mockReset().mockResolvedValue("checkpoint");
  });
  it("persists and activates a large workspace without exporting or changing its home revision", async () => {
    const h = harness();
    vi.mocked(checkpointAndRecordComputerWorkspace).mockRejectedValue(
      new Error("Workspace exceeds checkpoint limit"),
    );
    const ref = await h.replace();
    expect(ref).toEqual(h.ref);
    expect(h.row).toMatchObject({ state: "running", providerRef: "machine" });
    expect(h.sandbox.destroy).not.toHaveBeenCalled();
    expect(h.sandbox.provision).not.toHaveBeenCalled();
    expect(h.sandbox.prepare).toHaveBeenCalledWith(h.ref, context);
    expect(h.sandbox.persistWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(
      h.sandbox.updateImage.mock.invocationCallOrder[0]!,
    );
    expect(h.resume).not.toHaveBeenCalled();
    expect(checkpointAndRecordComputerWorkspace).not.toHaveBeenCalled();
    expect(
      h.deps.prisma.computer.updateMany.mock.calls.every(
        ([call]) => !("homeRevision" in call.data),
      ),
    ).toBe(true);
  });
  it.each(["update", "prepare"])(
    "keeps the original ref recoverable after %s fails",
    async (stage) => {
      const h = harness();
      (stage === "update" ? h.sandbox.updateImage : h.sandbox.prepare).mockRejectedValueOnce(
        new Error("provider failed"),
      );
      await expect(h.replace()).rejects.toThrow("provider failed");
      expect(h.row).toMatchObject({ state: "error", providerRef: "machine" });
      expect(h.sandbox.destroy).not.toHaveBeenCalled();
      expect(h.sandbox.provision).not.toHaveBeenCalled();
      expect(h.resume).toHaveBeenCalledOnce();
    },
  );

  it("exports before updating when the provider cannot preserve the volume", async () => {
    const h = harness();
    h.sandbox.persistWorkspace.mockResolvedValue(false);
    await h.replace();
    expect(checkpointAndRecordComputerWorkspace).toHaveBeenCalledOnce();
    expect(
      vi.mocked(checkpointAndRecordComputerWorkspace).mock.invocationCallOrder[0],
    ).toBeLessThan(h.sandbox.updateImage.mock.invocationCallOrder[0]!);
  });
  it("resumes paused services and never updates or destroys after a failed durable flush", async () => {
    const h = harness();
    h.sandbox.persistWorkspace.mockRejectedValue(new Error("disk failed"));
    await expect(h.replace()).rejects.toThrow("disk failed");
    expect(h.resume).toHaveBeenCalledOnce();
    expect(h.sandbox.updateImage).not.toHaveBeenCalled();
    expect(h.sandbox.destroy).not.toHaveBeenCalled();
    expect(h.row.providerRef).toBe("machine");
  });
  it.each(["stopped", "suspended"])(
    "updates a verified %s persistent VM without running sync or export",
    async (state) => {
      const h = harness();
      h.row.state = state;
      h.sandbox.isStoppedWithPersistentWorkspace.mockResolvedValue(true);
      await h.replace();
      expect(h.sandbox.persistWorkspace).not.toHaveBeenCalled();
      expect(h.sandbox.pauseWorkspaceForStop).not.toHaveBeenCalled();
      expect(checkpointAndRecordComputerWorkspace).not.toHaveBeenCalled();
      expect(h.sandbox.updateImage).toHaveBeenCalledOnce();
    },
  );
  it.each([false, true])(
    "requires a fresh portable backup before unsupported fallback (stopped=%s)",
    async (stopped) => {
      const h = harness();
      h.sandbox.isStoppedWithPersistentWorkspace.mockResolvedValue(stopped);
      if (stopped) h.row.state = "stopped";
      h.sandbox.updateImage.mockResolvedValue(undefined as never);
      vi.mocked(checkpointAndRecordComputerWorkspace).mockRejectedValue(
        new Error("Workspace exceeds checkpoint limit"),
      );
      await expect(h.replace()).rejects.toThrow("Workspace exceeds checkpoint limit");
      expect(checkpointAndRecordComputerWorkspace).toHaveBeenCalledOnce();
      expect(h.sandbox.destroy).not.toHaveBeenCalled();
      expect(h.sandbox.provision).not.toHaveBeenCalled();
      expect(h.row.providerRef).toBe("machine");
      expect(h.resume).toHaveBeenCalledTimes(stopped ? 0 : 1);
    },
  );
  it("uses replacement only when the provider explicitly reports unsupported", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "computer-update-test-"));
    try {
      const h = harness();
      h.sandbox.updateImage.mockResolvedValueOnce(undefined as never);
      const ref = await h.replace(dir);
      expect(ref.providerRef).toBe("replacement");
      expect(checkpointAndRecordComputerWorkspace).toHaveBeenCalledOnce();
      expect(
        vi.mocked(checkpointAndRecordComputerWorkspace).mock.invocationCallOrder[0],
      ).toBeLessThan(h.sandbox.destroy.mock.invocationCallOrder[0]!);
      expect(h.sandbox.destroy).toHaveBeenCalledOnce();
      expect(h.sandbox.provision).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
