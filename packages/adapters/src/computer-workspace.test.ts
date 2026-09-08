import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "@rakazo/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cachedWorkspaceSnapshot,
  checkpointAfterComputerWork,
  checkpointBeforeComputerStop,
  checkpointComputerWorkspace,
  ensureComputerWorkspaceLayout,
  restoreComputerWorkspace,
} from "./computer-workspace.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";

const context = {
  operationId: "workspace-test",
  traceId: "workspace-test",
  spaceId: "workspace",
  userId: "user",
  signal: new AbortController().signal,
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider-neutral computer workspace", () => {
  it("prepares shared and bot folders for a Team Computer", async () => {
    const provider = new FakeSandboxProvider();
    const computer = await provider.provision(
      { botId: "team-workspace", homePath: "/ignored" },
      context,
    );
    const execute = vi.spyOn(provider, "execute");

    await ensureComputerWorkspaceLayout(provider, computer, "team", "bot-1", {
      ...context,
      botId: "bot-1",
      screenLeaseId: "expired-display-lease",
    });

    expect(execute).toHaveBeenCalledWith(
      computer,
      { argv: ["mkdir", "-p", "shared", "bots/bot-1"], timeoutMs: 15000 },
      { ...context, botId: undefined, screenLeaseId: undefined },
    );
  });

  it("restores a checkpoint into a replacement provider machine", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-workspace-store-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const firstProvider = new FakeSandboxProvider();
    const first = await firstProvider.provision({ botId: "bot-1", homePath: "/ignored" }, context);

    await firstProvider.writeFile(
      first,
      {
        path: "notes/result.txt",
        content: new TextEncoder().encode("portable"),
      },
      context,
    );
    const revision = await checkpointComputerWorkspace(
      home,
      firstProvider,
      "bot-1",
      first,
      context,
    );

    const replacementProvider = new FakeSandboxProvider();
    const replacement = await replacementProvider.provision(
      { botId: "bot-1", homePath: "/different-provider" },
      context,
    );
    await restoreComputerWorkspace(home, replacementProvider, "bot-1", replacement, context);

    expect(revision).toMatch(/^rev-/);
    expect(
      new TextDecoder().decode(
        await replacementProvider.readFile(replacement, "notes/result.txt", context),
      ),
    ).toBe("portable");
  });
  it.each(["snapshot", "cache-write"])("keeps the durable home when %s fails", async (failure) => {
    const root = await mkdtemp(path.join(tmpdir(), "workspace-cache-"));
    roots.push(root);
    const home = Object.assign(new LocalAgentHomeStore(root), {
      saveWorkspaceSnapshot: vi.fn(async () => {
        if (failure === "cache-write") throw new Error("cache unavailable");
      }),
    });
    const provider = Object.assign(new FakeSandboxProvider(), {
      snapshotWorkspace: vi.fn(async () => {
        if (failure === "snapshot") throw new Error("provider unavailable");
        return "snapshot";
      }),
    });
    const first = await provider.provision({ botId: "bot", homePath: "/ignored" }, context);
    await provider.writeFile(
      first,
      { path: "saved.txt", content: Buffer.from("durable") },
      context,
    );
    await checkpointComputerWorkspace(home, provider, "bot", first, context);
    const replacementProvider = new FakeSandboxProvider();
    const replacement = await replacementProvider.provision(
      { botId: "bot", homePath: "/ignored" },
      context,
    );
    await restoreComputerWorkspace(home, replacementProvider, "bot", replacement, context);
    expect(
      Buffer.from(await replacementProvider.readFile(replacement, "saved.txt", context)).toString(),
    ).toBe("durable");
  });

  it("does not overwrite a natively restored home and tolerates cache lookup failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "workspace-cache-"));
    roots.push(root);
    const home = Object.assign(new LocalAgentHomeStore(root), {
      getWorkspaceSnapshot: vi.fn(async () => {
        throw new Error("cache unavailable");
      }),
    });
    const provider = Object.assign(new FakeSandboxProvider(), {
      snapshotWorkspace: async () => "snapshot",
    });
    const computer = await provider.provision({ botId: "bot", homePath: "/ignored" }, context);
    await provider.writeFile(
      computer,
      { path: "saved.txt", content: Buffer.from("native") },
      context,
    );
    await restoreComputerWorkspace(
      home,
      provider,
      "bot",
      { ...computer, workspaceRestored: true },
      context,
    );
    expect(Buffer.from(await provider.readFile(computer, "saved.txt", context)).toString()).toBe(
      "native",
    );
    await expect(cachedWorkspaceSnapshot(home, provider, "bot", context)).resolves.toBeUndefined();
  });
});

describe("stop workspace durability", () => {
  async function fixture(durable?: boolean) {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-stop-store-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const sandbox = new FakeSandboxProvider();
    if (durable !== undefined)
      Object.assign(sandbox, {
        isStoppedWithPersistentWorkspace: vi.fn().mockResolvedValue(durable),
      });
    const computer = await sandbox.provision({ botId: "stop-home", homePath: "/ignored" }, context);
    await sandbox.writeFile(
      computer,
      { path: "saved.txt", content: new TextEncoder().encode("keep me") },
      context,
    );
    const exported = vi.spyOn(sandbox, "exportWorkspace");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deps = {
      home,
      sandbox,
      prisma: { computer: { updateMany } } as unknown as PrismaClient,
    };
    return { deps, computer, exported, updateMany };
  }
  it("does not contact the desktop when the provider verifies an already stopped persistent computer", async () => {
    const { deps, computer, exported, updateMany } = await fixture(true);
    await checkpointBeforeComputerStop(
      deps,
      { id: computer.id, homeKey: computer.botId },
      computer,
      context,
    );
    expect(exported).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
  it.each([undefined, false])(
    "retains a restorable checkpoint when durable stop is %s",
    async (durable) => {
      const { deps, computer, exported, updateMany } = await fixture(durable);
      await checkpointBeforeComputerStop(
        deps,
        { id: computer.id, homeKey: computer.botId },
        computer,
        context,
      );
      expect(exported).toHaveBeenCalledOnce();
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { homeRevision: expect.stringMatching(/^rev-/) },
        }),
      );
      const files = [];
      for await (const file of deps.home.exportHome(computer.botId, context)) files.push(file);
      expect(
        new TextDecoder().decode(files.find((file) => file.path === "saved.txt")?.content),
      ).toBe("keep me");
    },
  );
  it("fails closed when provider ownership or durability cannot be verified", async () => {
    const { deps, computer, exported } = await fixture();
    Object.assign(deps.sandbox, {
      isStoppedWithPersistentWorkspace: vi
        .fn()
        .mockRejectedValue(new Error("Computer access denied")),
    });
    await expect(
      checkpointBeforeComputerStop(
        deps,
        { id: computer.id, homeKey: computer.botId },
        computer,
        context,
      ),
    ).rejects.toThrow("Computer access denied");
    expect(exported).not.toHaveBeenCalled();
  });
});

it("quiesces browser profile writes before Stop and restores them if the checkpoint fails", async () => {
  const resume = vi.fn().mockResolvedValue(undefined);
  const pause = vi.fn().mockResolvedValue(resume);
  const exported = vi.fn(async function* () {
    yield await Promise.reject(new Error("backup unavailable"));
  });
  const deps = {
    sandbox: { pauseWorkspaceForStop: pause, exportWorkspace: exported },
    home: {},
    prisma: {},
  } as unknown as Parameters<typeof checkpointBeforeComputerStop>[0];
  const computer = {
    id: "computer",
    botId: "home",
    kind: "fly" as const,
    providerRef: "ref",
  };
  await expect(
    checkpointBeforeComputerStop(deps, { id: "computer", homeKey: "home" }, computer, context),
  ).rejects.toThrow("backup unavailable");
  expect(pause.mock.invocationCallOrder[0]).toBeLessThan(exported.mock.invocationCallOrder[0]!);
  expect(resume).toHaveBeenCalledOnce();
});

describe("task checkpoints on persistent computers", () => {
  const computer = {
    id: "vm",
    providerRef: "vm",
    botId: "home",
    kind: "fly" as const,
  };
  it("flushes durable storage without exporting the entire running browser profile", async () => {
    const exportWorkspace = vi.fn();
    const persistWorkspace = vi.fn().mockResolvedValue(true);
    const updateMany = vi.fn();
    await checkpointAfterComputerWork(
      {
        sandbox: { persistWorkspace, exportWorkspace } as never,
        home: {} as never,
        prisma: { computer: { updateMany } } as never,
      },
      { id: "db", homeKey: "home" },
      computer,
      context,
    );
    expect(persistWorkspace).toHaveBeenCalledWith(computer, context);
    expect(exportWorkspace).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
  it("does not acknowledge a failed durable flush", async () => {
    const persistWorkspace = vi.fn().mockRejectedValue(new Error("disk failed"));
    await expect(
      checkpointAfterComputerWork(
        {
          sandbox: { persistWorkspace } as never,
          home: {} as never,
          prisma: {} as never,
        },
        { id: "db", homeKey: "home" },
        computer,
        context,
      ),
    ).rejects.toThrow("disk failed");
  });
  it("retains portable checkpoints when the provider cannot persist in place", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rakazo-task-checkpoint-"));
    roots.push(root);
    const home = new LocalAgentHomeStore(root);
    const provider = new FakeSandboxProvider();
    const ref = await provider.provision({ botId: "home", homePath: "/ignored" }, context);
    await provider.writeFile(
      ref,
      { path: "proof.txt", content: new TextEncoder().encode("saved") },
      context,
    );
    const updateMany = vi.fn();
    await checkpointAfterComputerWork(
      {
        home,
        sandbox: provider,
        prisma: { computer: { updateMany } } as never,
      },
      { id: "db", homeKey: "home" },
      ref,
      context,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "db" },
      data: { homeRevision: expect.stringMatching(/^rev-/) },
    });
  });
});

it("stops a large durable workspace without portable export or claiming a home revision", async () => {
  const resume = vi.fn().mockResolvedValue(undefined);
  const pauseWorkspaceForStop = vi.fn().mockResolvedValue(resume);
  const persistWorkspace = vi.fn().mockResolvedValue(true);
  const exportWorkspace = vi.fn(async function* () {
    yield await Promise.reject(new Error("Workspace exceeds checkpoint limit"));
  });
  const updateMany = vi.fn();
  const deps = {
    sandbox: { pauseWorkspaceForStop, persistWorkspace, exportWorkspace },
    home: {},
    prisma: { computer: { updateMany } },
  } as unknown as Parameters<typeof checkpointBeforeComputerStop>[0];
  const computer = {
    id: "vm",
    providerRef: "vm",
    botId: "home",
    kind: "fly" as const,
  };
  expect(
    await checkpointBeforeComputerStop(deps, { id: "db", homeKey: "home" }, computer, context),
  ).toBe(resume);
  expect(pauseWorkspaceForStop.mock.invocationCallOrder[0]).toBeLessThan(
    persistWorkspace.mock.invocationCallOrder[0]!,
  );
  expect(exportWorkspace).not.toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
  expect(resume).not.toHaveBeenCalled();
});

it("resumes browser services if durable Stop persistence fails", async () => {
  const resume = vi.fn().mockResolvedValue(undefined);
  const persistWorkspace = vi.fn().mockRejectedValue(new Error("disk failed"));
  const exportWorkspace = vi.fn();
  const deps = {
    sandbox: {
      pauseWorkspaceForStop: vi.fn().mockResolvedValue(resume),
      persistWorkspace,
      exportWorkspace,
    },
    home: {},
    prisma: {},
  } as unknown as Parameters<typeof checkpointBeforeComputerStop>[0];
  const computer = {
    id: "vm",
    providerRef: "vm",
    botId: "home",
    kind: "fly" as const,
  };
  await expect(
    checkpointBeforeComputerStop(deps, { id: "db", homeKey: "home" }, computer, context),
  ).rejects.toThrow("disk failed");
  expect(resume).toHaveBeenCalledOnce();
  expect(exportWorkspace).not.toHaveBeenCalled();
});
