import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
  it("checkpoints and activates the same workspace without destroy, provision, or restore", async () => {
    const h = harness();
    const ref = await h.replace();
    expect(ref).toEqual(h.ref);
    expect(h.row).toMatchObject({ state: "running", providerRef: "machine" });
    expect(h.sandbox.destroy).not.toHaveBeenCalled();
    expect(h.sandbox.provision).not.toHaveBeenCalled();
    expect(h.sandbox.prepare).toHaveBeenCalledWith(h.ref, context);
    expect(
      vi.mocked(checkpointAndRecordComputerWorkspace).mock.invocationCallOrder.at(-1)!,
    ).toBeLessThan(h.sandbox.updateImage.mock.invocationCallOrder[0]!);
    expect(h.resume).not.toHaveBeenCalled();
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
  it("uses replacement only when the provider explicitly reports unsupported", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "computer-update-test-"));
    try {
      const h = harness();
      h.sandbox.updateImage.mockResolvedValueOnce(undefined as never);
      const ref = await h.replace(dir);
      expect(ref.providerRef).toBe("replacement");
      expect(h.sandbox.destroy).toHaveBeenCalledOnce();
      expect(h.sandbox.provision).toHaveBeenCalledOnce();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
