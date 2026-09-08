import { RPCHandler } from "@orpc/server/fetch";
import { acquireComputerExecutionLease } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const actor: Actor = {
  spaceId: "space-test",
  userId: "user-test",
  email: "user@example.test",
  isDeploymentOwner: true,
};

describe("computer stop fencing", () => {
  it.each([false, true])(
    "retains fencing tombstones across stop (persistence failure=%s)",
    async (fails) => {
      const computer = {
        id: "computer-test",
        kind: "fly",
        providerRef: "vm-test",
        homeKey: "home-test",
        homeRevision: "old-backup",
        state: "running",
        scope: "team",
        controlHolder: "none",
      };
      let lease = { runId: "previous-run", fence: 7, expiresAt: new Date(Date.now() + 60_000) };
      const resume = vi.fn();
      const stop = vi.fn();
      const prisma = {
        bot: { findFirst: vi.fn(async () => ({ id: "bot-test", name: "Test", computer })) },
        computer: {
          updateMany: vi.fn(async ({ data }) => {
            Object.assign(computer, data);
            return { count: 1 };
          }),
          update: vi.fn(async ({ data }) => {
            Object.assign(computer, data);
            return computer;
          }),
          findUniqueOrThrow: vi.fn(async () => computer),
        },
        run: {
          findFirst: vi.fn().mockResolvedValue(null),
          findUnique: vi.fn().mockResolvedValue(null),
        },
        computerExecutionLease: {
          deleteMany: vi.fn(async () => {
            lease = { ...lease, fence: 0 };
            return { count: 1 };
          }),
          updateMany: vi.fn(async ({ data }) => {
            lease = { ...lease, ...data };
            return { count: 1 };
          }),
          updateManyAndReturn: vi.fn(async ({ data }) => {
            expect(lease.expiresAt.getTime()).toBe(0);
            lease = { ...lease, ...data, fence: lease.fence + data.fence.increment };
            return [{ fence: lease.fence }];
          }),
          findUnique: vi.fn(async () => lease),
        },
      };
      const deps = {
        prisma,
        jobs: { cancel: vi.fn() },
        sandbox: {
          isStoppedWithPersistentWorkspace: vi.fn().mockResolvedValue(false),
          pauseWorkspaceForStop: vi.fn().mockResolvedValue(resume),
          persistWorkspace: vi.fn(async () => {
            if (fails) throw new Error("disk sync failed");
            return true;
          }),
          stop,
        },
        env: { defaultProvider: "fake", defaultModel: "fake-model" },
      } as unknown as RouterDeps;
      const handler = new RPCHandler(createRouter(deps));
      const { response } = await handler.handle(
        new Request("http://localhost/rpc/computer/stop", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: "bot-test" } }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      expect(response.status).toBe(fails ? 500 : 200);
      expect(prisma.computerExecutionLease.deleteMany).not.toHaveBeenCalled();
      expect(lease.fence).toBe(7);
      expect(lease.expiresAt.getTime()).toBe(0);
      if (fails) {
        expect(resume).toHaveBeenCalledOnce();
        expect(stop).not.toHaveBeenCalled();
      }
      const next = await acquireComputerExecutionLease(prisma as unknown as PrismaClient, {
        computerId: computer.id,
        botId: "bot-test",
        runId: "next-boot",
      });
      expect(next?.fence).toBe(8);
    },
  );
});
