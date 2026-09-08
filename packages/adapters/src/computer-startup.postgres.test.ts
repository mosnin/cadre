import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { ComputerBusyError, provisionComputer } from "./computer-lifecycle.js";

const databaseUrl = process.env.DATABASE_URL;
const suite = process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;
async function fixture() {
  const db = createDb(databaseUrl!);
  const id = randomUUID();
  const dir = await mkdtemp(path.join(tmpdir(), "startup-db-"));
  await db.prisma.organization.create({
    data: {
      id,
      name: "Startup fixture",
      slug: id,
      createdAt: new Date(),
      spaces: { create: { id, name: "Startup fixture" } },
    },
  });
  const requestedAt = new Date(Date.now() - 600000);
  const computer = await db.prisma.computer.create({
    data: {
      spaceId: id,
      userId: id,
      scope: "dedicated",
      scopeKey: id,
      homeKey: id,
      kind: "fly",
      providerRef: "1234567890abcd",
      state: "booting",
      startupOperationId: "dead-owner",
      startupExpiresAt: new Date(0),
      startupRequestedAt: requestedAt,
    },
  });
  const ref = {
    id: computer.providerRef!,
    providerRef: computer.providerRef!,
    botId: id,
    kind: "fly" as const,
    fresh: false,
    workspaceRestored: true,
  };
  const sandbox = {
    describe: () => ({ id: "fly", capabilities: { persistentRunning: true } }),
    provision: vi.fn().mockResolvedValue(ref),
    prepare: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    destroy: vi.fn(),
    execute: vi.fn(async function* () {
      yield { type: "exit", code: 0 };
    }),
  };
  const deps = {
    prisma: db.prisma,
    sandbox,
    home: {},
    jobs: {},
    events: {},
    dataDir: dir,
  } as unknown as Parameters<typeof provisionComputer>[0];
  const context = {
    operationId: "test",
    traceId: "test",
    spaceId: id,
    userId: id,
    signal: new AbortController().signal,
  };
  return {
    db,
    computer,
    ref,
    sandbox,
    deps,
    context,
    requestedAt,
    async close() {
      await db.prisma.organization.delete({ where: { id } });
      await db.prisma.$disconnect();
      await db.pool.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
suite("durable computer startup ownership (PostgreSQL)", () => {
  it("allows one expired owner claim and fences the other concurrent worker", async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    f.sandbox.prepare.mockImplementation(async () => gate);
    try {
      const attempts = [
        provisionComputer(f.deps, f.computer.id, f.context, "none", f.requestedAt),
        provisionComputer(f.deps, f.computer.id, f.context, "none", f.requestedAt),
      ];
      const caught = attempts.map((p) =>
        p.then(
          (value) => ({ value }),
          (error) => ({ error }),
        ),
      );
      await vi.waitFor(() => expect(f.sandbox.prepare).toHaveBeenCalledOnce());
      expect(f.sandbox.provision).toHaveBeenCalledOnce();
      release();
      const results = await Promise.all(caught);
      expect(results.filter((r) => "value" in r)).toHaveLength(1);
      expect(results.find((r) => "error" in r)).toMatchObject({
        error: expect.any(ComputerBusyError),
      });
      const row = await f.db.prisma.computer.findUniqueOrThrow({ where: { id: f.computer.id } });
      expect(row.state).toBe("running");
      expect(row.startupAttempts).toBe(1);
    } finally {
      release();
      await f.close();
    }
  });
  it.each(["stopped", "successor"])(
    "cannot activate or roll back a VM after %s invalidates ownership",
    async (replacement) => {
      const f = await fixture();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      f.sandbox.prepare.mockImplementation(async () => gate);
      try {
        const result = provisionComputer(
          f.deps,
          f.computer.id,
          f.context,
          "none",
          f.requestedAt,
        ).catch((error) => error);
        await vi.waitFor(() => expect(f.sandbox.prepare).toHaveBeenCalledOnce());
        const row = await f.db.prisma.computer.findUniqueOrThrow({ where: { id: f.computer.id } });
        await f.db.prisma.computer.update({
          where: { id: row.id },
          data:
            replacement === "stopped"
              ? {
                  state: "stopped",
                  startupOperationId: null,
                  startupExpiresAt: null,
                  startupRequestedAt: null,
                }
              : {
                  startupOperationId: "successor",
                  startupExpiresAt: new Date(Date.now() + 300000),
                },
        });
        release();
        expect(await result).toBeInstanceOf(ComputerBusyError);
        expect(f.sandbox.stop).not.toHaveBeenCalled();
        expect(f.sandbox.destroy).not.toHaveBeenCalled();
        const after = await f.db.prisma.computer.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.providerRef).toBe(f.ref.providerRef);
        expect(after.state).toBe(replacement === "stopped" ? "stopped" : "booting");
        expect(after.startupOperationId).toBe(replacement === "stopped" ? null : "successor");
      } finally {
        release();
        await f.close();
      }
    },
  );
});

suite("startup result recovery (PostgreSQL)", () => {
  it.each([false, true])(
    "preserves pending restoration across failed prepare (native volume=%s)",
    async (native) => {
      const f = await fixture();
      const importWorkspace = vi.fn(async () => {});
      Object.assign(f.sandbox, { importWorkspace });
      Object.assign(f.deps.home, {
        exportHome: async function* () {
          yield { path: "proof.txt", content: new TextEncoder().encode("SAVED") };
        },
      });
      try {
        await f.db.prisma.computer.update({
          where: { id: f.computer.id },
          data: {
            providerRef: null,
            state: "stopped",
            startupOperationId: null,
            startupExpiresAt: null,
          },
        });
        f.sandbox.provision
          .mockResolvedValueOnce({ ...f.ref, fresh: !native, workspaceRestored: native })
          .mockResolvedValue({ ...f.ref, fresh: false, workspaceRestored: true });
        f.sandbox.prepare.mockRejectedValueOnce(new Error("prepare failed"));
        await expect(provisionComputer(f.deps, f.computer.id, f.context)).rejects.toThrow(
          "prepare failed",
        );
        const failed = await f.db.prisma.computer.findUniqueOrThrow({
          where: { id: f.computer.id },
        });
        expect(failed.providerRef).toBe(f.ref.providerRef);
        expect(failed.workspaceRestorePending).toBe(!native);
        await provisionComputer(f.deps, f.computer.id, f.context);
        expect(importWorkspace).toHaveBeenCalledTimes(native ? 0 : 1);
        expect(
          (await f.db.prisma.computer.findUniqueOrThrow({ where: { id: f.computer.id } }))
            .workspaceRestorePending,
        ).toBe(false);
      } finally {
        await f.close();
      }
    },
  );
  it.each(["stopped", "successor"])(
    "records a late create after %s without touching a successor",
    async (state) => {
      const f = await fixture();
      let release!: (value: typeof f.ref) => void;
      f.sandbox.provision.mockImplementation(
        () =>
          new Promise((r) => {
            release = r;
          }),
      );
      try {
        const result = provisionComputer(
          f.deps,
          f.computer.id,
          f.context,
          "none",
          f.requestedAt,
        ).catch((error) => error);
        await vi.waitFor(() => expect(f.sandbox.provision).toHaveBeenCalledOnce());
        await f.db.prisma.computer.update({
          where: { id: f.computer.id },
          data:
            state === "stopped"
              ? {
                  state: "stopped",
                  startupOperationId: null,
                  startupExpiresAt: null,
                  startupRequestedAt: null,
                }
              : { state: "running", startupOperationId: null, startupExpiresAt: null },
        });
        release(f.ref);
        expect(await result).toBeInstanceOf(ComputerBusyError);
        expect(f.sandbox.stop).toHaveBeenCalledTimes(state === "stopped" ? 1 : 0);
        expect(f.sandbox.destroy).not.toHaveBeenCalled();
        const after = await f.db.prisma.computer.findUniqueOrThrow({
          where: { id: f.computer.id },
        });
        expect(after.state).toBe(state === "stopped" ? "stopped" : "running");
        expect(after.providerRef).toBe(f.ref.providerRef);
      } finally {
        await f.close();
      }
    },
  );
  it("refuses provider effects when delayed claim acknowledgement has consumed deadline", async () => {
    const f = await fixture();
    const original = f.db.prisma.computer.updateMany.bind(f.db.prisma.computer);
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    try {
      vi.spyOn(f.db.prisma.computer, "updateMany").mockImplementationOnce((async (
        args: Parameters<typeof original>[0],
      ) => {
        const result = await original(args);
        clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 160000);
        return result;
      }) as unknown as typeof original);
      await expect(
        provisionComputer(f.deps, f.computer.id, f.context, "none", f.requestedAt),
      ).rejects.toThrow("deadline expired");
      expect(f.sandbox.provision).not.toHaveBeenCalled();
    } finally {
      clock?.mockRestore();
      await f.close();
    }
  });
});

suite("timeout drain and late result cleanup (PostgreSQL)", () => {
  it("blocks retry during drain and safely stops a late result under its own retained token", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let release!: (value: typeof f.ref) => void;
    f.sandbox.provision.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    try {
      const result = provisionComputer(
        f.deps,
        f.computer.id,
        { ...f.context, signal: controller.signal },
        "none",
        f.requestedAt,
      ).catch((error) => error);
      await vi.waitFor(() => expect(f.sandbox.provision).toHaveBeenCalledOnce());
      controller.abort(new Error("cancelled startup"));
      expect(await result).toMatchObject({ message: "cancelled startup" });
      const draining = await f.db.prisma.computer.findUniqueOrThrow({
        where: { id: f.computer.id },
      });
      expect(draining.state).toBe("error");
      expect(draining.startupOperationId).not.toBeNull();
      expect(draining.startupDrainUntil!.getTime()).toBeGreaterThan(Date.now());
      await expect(provisionComputer(f.deps, f.computer.id, f.context)).rejects.toBeInstanceOf(
        ComputerBusyError,
      );
      release(f.ref);
      await vi.waitFor(async () => {
        expect(
          (await f.db.prisma.computer.findUniqueOrThrow({ where: { id: f.computer.id } })).state,
        ).toBe("stopped");
      });
      expect(f.sandbox.stop).toHaveBeenCalledOnce();
      expect(f.sandbox.destroy).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});
