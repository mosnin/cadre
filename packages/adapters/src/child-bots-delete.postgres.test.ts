import { randomUUID } from "node:crypto";
import type { AgentHomeStore, JobPublisher, SandboxProvider } from "@rakazo/adapter-kit";
import { createDb } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { BotDeletionBusyError, destroyBot } from "./child-bots.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("bot deletion startup exclusion (PostgreSQL)", () => {
  it("retains the cleanup anchor through startup, stopped drain, cleanup, and failed provider deletion", async () => {
    const { prisma, pool } = createDb(databaseUrl!);
    const id = randomUUID();
    const destroy = vi.fn().mockRejectedValue(new Error("provider deletion failed"));
    const context = {
      spaceId: id,
      userId: id,
      botId: id,
      operationId: "test-delete",
      traceId: "test-delete",
      signal: new AbortController().signal,
    };
    try {
      await prisma.user.create({
        data: { id, name: "Deletion test", email: `${id}@example.test` },
      });
      await prisma.organization.create({
        data: { id, name: "Deletion test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Test", createdByUserId: id },
      });
      await prisma.computer.create({
        data: {
          id,
          spaceId: id,
          userId: id,
          scope: "dedicated",
          scopeKey: `bot:${id}`,
          homeKey: id,
          kind: "fly",
          providerRef: "machine-test",
          state: "booting",
        },
      });
      const bot = await prisma.bot.create({
        data: { id, spaceId: id, userId: id, name: "Test", color: "#000", computerId: id },
      });
      const deps = {
        prisma,
        sandbox: { destroy } as unknown as SandboxProvider,
        home: {} as AgentHomeStore,
        jobs: { cancel: vi.fn() } as unknown as JobPublisher,
      };
      const future = new Date(Date.now() + 60_000);
      for (const data of [
        {
          state: "booting",
          startupOperationId: "startup",
          startupExpiresAt: future,
          startupDrainUntil: future,
        },
        // Stop invalidates ownership, but the original provider call can still settle later.
        {
          state: "stopped",
          startupOperationId: null,
          startupExpiresAt: null,
          startupDrainUntil: future,
        },
        {
          state: "error",
          startupOperationId: "cleanup",
          startupExpiresAt: future,
          startupDrainUntil: null,
        },
      ]) {
        await prisma.computer.update({ where: { id }, data });
        await expect(
          destroyBot(deps, bot, context, { deleteMemories: true }),
        ).rejects.toBeInstanceOf(BotDeletionBusyError);
        expect(await prisma.bot.findUnique({ where: { id } })).toMatchObject({
          computerSwitching: false,
          archivedAt: null,
        });
        expect(await prisma.computer.findUnique({ where: { id } })).toMatchObject(data);
        expect(destroy).not.toHaveBeenCalled();
      }
      await prisma.computer.update({
        where: { id },
        data: {
          state: "stopped",
          startupOperationId: null,
          startupExpiresAt: null,
          startupDrainUntil: new Date(0),
        },
      });
      await expect(destroyBot(deps, bot, context, { deleteMemories: true })).rejects.toThrow(
        "provider deletion failed",
      );
      expect(await prisma.bot.findUnique({ where: { id } })).toMatchObject({
        computerSwitching: false,
        archivedAt: expect.any(Date),
      });
      expect(await prisma.computer.findUnique({ where: { id } })).toMatchObject({
        state: "error",
        providerRef: "machine-test",
      });
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      await prisma.organization.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id } });
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
