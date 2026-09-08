import { RPCHandler } from "@orpc/server/fetch";
import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space-test",
  userId: "user-test",
  email: "user@example.test",
  isDeploymentOwner: true,
};

function fixture(state: string, expiresAt: Date | null = null) {
  const computer = {
    id: "computer-test",
    kind: "fly",
    providerRef: "machine-test",
    homeKey: "home-test",
    homeRevision: "backup",
    scope: "team",
    controlHolder: "none",
    state,
    updatedAt: new Date(Date.now() - 300_000),
    startupOperationId: expiresAt ? "old-owner" : null,
    startupExpiresAt: expiresAt,
    startupRequestedAt: null as Date | null,
    startupBotId: "bot-test",
    startupAttempts: 2,
    workspaceRestorePending: true,
  };
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const prepare = vi.fn().mockResolvedValue(undefined);
  const provision = vi.fn();
  const prisma = {
    bot: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn(async () => ({ id: "bot-test", name: "Test", computer: { ...computer } })),
    },
    computer: {
      findUniqueOrThrow: vi.fn(async () => ({ ...computer })),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.updatedAt && where.updatedAt.getTime() !== computer.updatedAt.getTime())
          return { count: 0 };
        Object.assign(computer, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
    },
    computerExecutionLease: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateManyAndReturn: vi.fn(),
    },
  };
  const deps = {
    prisma,
    jobs: { enqueue },
    sandbox: {
      describe: () => ({ capabilities: { persistentRunning: true } }),
      prepare,
      provision,
    },
    env: { defaultProvider: "fake", defaultModel: "fake-model" },
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  const call = (rpcPath = "computer/boot", extra = {}) =>
    handler.handle(
      new Request(`http://localhost/rpc/${rpcPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: "bot-test", ...extra } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
  return { computer, prisma, enqueue, prepare, provision, call };
}

describe("durable API computer startup", () => {
  it.each(["stopped", "suspended", "error", "booting"])(
    "queues %s startup without holding the request or screen lease",
    async (state) => {
      const f = fixture(state);
      const { response } = await f.call();
      expect(response.status).toBe(200);
      expect((await response.json()).json.state).toBe("booting");
      expect(f.computer).toMatchObject({
        startupOperationId: null,
        startupExpiresAt: new Date(0),
        startupBotId: "bot-test",
        startupAttempts: 0,
        workspaceRestorePending: true,
      });
      expect(f.enqueue).toHaveBeenCalledWith({
        name: "computer.warm",
        payload: { botId: "bot-test", version: f.computer.startupRequestedAt!.toISOString() },
        replaceKey: "computer.warm:computer-test",
      });
      expect(f.provision).not.toHaveBeenCalled();
      expect(f.prisma.computerExecutionLease.updateManyAndReturn).not.toHaveBeenCalled();
    },
  );
  it("returns the active startup without creating another intent", async () => {
    const f = fixture("booting", new Date(Date.now() + 60_000));
    const { response } = await f.call();
    expect(response.status).toBe(200);
    expect((await response.json()).json.state).toBe("booting");
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.computer.startupOperationId).toBe("old-owner");
  });
  it("replaces expired startup ownership even while the old screen lease could remain held", async () => {
    const f = fixture("booting", new Date(0));
    expect((await f.call()).response.status).toBe(200);
    expect(f.computer.startupOperationId).toBeNull();
    expect(f.enqueue).toHaveBeenCalledOnce();
    expect(f.prisma.computerExecutionLease.updateManyAndReturn).not.toHaveBeenCalled();
  });
  it("keeps the startup intent recoverable when enqueue fails", async () => {
    const f = fixture("stopped");
    f.enqueue.mockRejectedValue(new Error("queue unavailable"));
    expect((await f.call()).response.status).toBe(200);
    expect(f.computer.state).toBe("booting");
    expect(f.computer.startupRequestedAt).toBeInstanceOf(Date);
    expect(f.computer.startupExpiresAt).toEqual(new Date(0));
  });
  it("does not queue a startup across an explicit Stop", async () => {
    const f = fixture("suspending");
    expect((await f.call()).response.status).toBe(409);
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.prisma.computer.updateMany).not.toHaveBeenCalled();
  });
  it("does not overwrite a live cleanup operation on an error record", async () => {
    const f = fixture("error", new Date(Date.now() + 60_000));
    expect((await f.call()).response.status).toBe(409);
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.computer.startupOperationId).toBe("old-owner");
  });
  it("does not invalidate cleanup ownership through Stop", async () => {
    const f = fixture("error", new Date(Date.now() + 60_000));
    expect((await f.call("computer/stop")).response.status).toBe(409);
    expect(f.prisma.computer.updateMany).not.toHaveBeenCalled();
    expect(f.computer.startupOperationId).toBe("old-owner");
  });
  it.each(["booting", "suspending"])("does not detach a computer while %s", async (state) => {
    const f = fixture(state);
    expect((await f.call("bots/setComputer", { mode: "dedicated" })).response.status).toBe(409);
    expect(f.prisma.bot.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "bot-test", computerSwitching: false },
      data: { computerSwitching: true },
    });
    expect(f.prisma.bot.updateMany).toHaveBeenLastCalledWith({
      where: { id: "bot-test" },
      data: { computerSwitching: false },
    });
    expect(f.prisma.computer.updateMany).not.toHaveBeenCalled();
  });
  it("bounds readiness checks for a running machine", async () => {
    const f = fixture("running");
    expect((await f.call()).response.status).toBe(200);
    expect(f.prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(f.provision).not.toHaveBeenCalled();
  });
});
