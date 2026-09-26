import { randomUUID } from "node:crypto";
import {
  bootstrapUserSpace,
  createDb,
  createRepos,
  createThreadEvents,
  requireMembership,
} from "@cadre/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createOperateWork, type OperatePeer, operateTaskPrompt } from "./operate-work.js";
import { InMemoryRealtimeFanout } from "./realtime.js";

describe("Operate task prompt", () => {
  it("carries the task and its context, and leaves the Operate protocol to Cadre", () => {
    const prompt = operateTaskPrompt({
      botName: "Scout",
      task: {
        taskId: "task_1",
        title: "Triage the inbox",
        description: "Everything older than a day.",
      },
      context: { readiness: { ready: true } },
    });
    expect(prompt).toContain("Operate task: Triage the inbox");
    expect(prompt).toContain("Task id: task_1");
    expect(prompt).toContain("Everything older than a day.");
    expect(prompt).toContain('"ready": true');
    expect(prompt).toContain('call agent_brief with agent "Scout"');
    expect(prompt).toContain("Do not claim, complete, or release it");
  });

  it("trims a very large context and says so", () => {
    const prompt = operateTaskPrompt({
      botName: "Scout",
      task: { taskId: "t", title: "T" },
      context: { blob: "x".repeat(40_000) },
    });
    expect(prompt).toContain("(context trimmed)");
    expect(prompt.length).toBeLessThan(20_000);
  });
});

const databaseUrl = process.env.VERIFY_DATABASE ? process.env.DATABASE_URL : undefined;
describe.skipIf(!databaseUrl)("Operate work loop", () => {
  const db = databaseUrl ? createDb(databaseUrl) : null;
  afterAll(async () => {
    await db?.prisma.$disconnect();
    await db?.pool.end();
  });

  it("claims one task, runs it, and writes the outcome back exactly once", async () => {
    const { prisma, pool } = db!;
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.com`, name: "Operate test" },
    });
    const { spaceId } = await bootstrapUserSpace(
      prisma,
      { id: userId },
      { signupsEnabled: "true", signupAllowlist: undefined },
      { claimDeploymentOwner: false },
    );
    try {
      const actor = await requireMembership(prisma, userId, spaceId);
      const bot = await createRepos(prisma).createBot(actor, {
        name: "Scout",
        title: "",
        description: "",
        instructions: "",
        notifyOnFinish: true,
      });
      const events = createThreadEvents(prisma, new InMemoryRealtimeFanout());

      let handedOut = false;
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      const call = vi.fn<OperatePeer["call"]>(async (name, args = {}) => {
        calls.push({ name, args });
        switch (name) {
          case "next_task":
            if (handedOut) return { tasks: [] };
            handedOut = true;
            return {
              tasks: [{ taskId: "task_1", title: "Triage the inbox", description: "Old mail" }],
            };
          case "get_task_context":
            return { readiness: { ready: true }, acknowledge: [{ packetId: "p1", version: 2 }] };
          case "start_run":
            return "operate_run_1";
          default:
            return { ok: true };
        }
      });
      const enqueue = vi.fn(async () => {});
      const deps = {
        prisma,
        pool,
        events,
        jobs: { enqueue, cancel: vi.fn(async () => {}), close: vi.fn(async () => {}) },
        credential: vi.fn(async () => ({
          endpoint: "https://operate.example/api/mcp",
          token: "test-operate-token-not-real",
        })),
        connect: vi.fn(async () => ({ call, close: async () => {} })),
      };
      const work = createOperateWork(deps);
      await work.configure(actor, { botId: bot.id });
      const worker = await prisma.operateWorker.findUniqueOrThrow({ where: { botId: bot.id } });

      await work.tickWorker(worker.id);
      const assignment = await prisma.operateAssignment.findFirstOrThrow({
        where: { workerId: worker.id },
      });
      expect(assignment).toMatchObject({ taskId: "task_1", operateRunId: "operate_run_1" });
      expect(assignment.runId).toBeTruthy();
      expect(calls.map((c) => c.name)).toEqual([
        "next_task",
        "get_task_context",
        "acknowledge_task_context",
        "claim_task",
        "start_run",
      ]);
      expect(calls[2]!.args).toEqual({
        taskId: "task_1",
        packets: [{ packetId: "p1", version: 2 }],
      });
      expect(enqueue).toHaveBeenCalledTimes(1);

      // While the run is in flight, a second loop instance neither reports nor pulls.
      calls.length = 0;
      await Promise.all([
        work.tickWorker(worker.id),
        createOperateWork(deps).tickWorker(worker.id),
      ]);
      expect(calls.map((c) => c.name)).toEqual([]);
      expect(await prisma.run.count({ where: { spaceId } })).toBe(1);

      const run = await prisma.run.findUniqueOrThrow({ where: { id: assignment.runId! } });
      await prisma.run.update({ where: { id: run.id }, data: { status: "completed" } });
      await prisma.message.create({
        data: {
          threadId: run.threadId,
          seq: 2,
          role: "bot",
          botId: run.botId,
          runId: run.id,
          blocks: [{ kind: "text", text: "Archived 40 threads and replied to 3." }],
        },
      });
      await work.tickWorker(worker.id);
      expect(calls.filter((c) => c.name !== "next_task")).toEqual([
        {
          name: "finish_run",
          args: {
            runId: "operate_run_1",
            status: "succeeded",
            summary: "Archived 40 threads and replied to 3.",
          },
        },
        {
          name: "complete_task",
          args: { taskId: "task_1", note: "Archived 40 threads and replied to 3." },
        },
      ]);
      const status = await work.status(actor);
      expect(status!.assignments[0]).toMatchObject({ taskId: "task_1", reported: true });
      expect(JSON.stringify(status)).not.toContain("test-operate-token-not-real");

      // Reported work is never reported twice.
      calls.length = 0;
      await work.tickWorker(worker.id);
      expect(calls.map((c) => c.name)).toEqual(["next_task"]);

      expect(await work.status({ ...actor, userId: "other-user" })).toBeNull();
    } finally {
      await prisma.space.delete({ where: { id: spaceId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it("gives a failed run's task back to Operate", async () => {
    const { prisma, pool } = db!;
    const userId = randomUUID();
    await prisma.user.create({
      data: { id: userId, email: `${userId}@example.com`, name: "Operate test" },
    });
    const { spaceId } = await bootstrapUserSpace(
      prisma,
      { id: userId },
      { signupsEnabled: "true", signupAllowlist: undefined },
      { claimDeploymentOwner: false },
    );
    try {
      const actor = await requireMembership(prisma, userId, spaceId);
      const bot = await createRepos(prisma).createBot(actor, {
        name: "Scout",
        title: "",
        description: "",
        instructions: "",
        notifyOnFinish: true,
      });
      let handedOut = false;
      const calls: string[] = [];
      const call = vi.fn<OperatePeer["call"]>(async (name) => {
        calls.push(name);
        if (name === "next_task") {
          if (handedOut) return { tasks: [] };
          handedOut = true;
          return { tasks: [{ taskId: "task_2", title: "Reconcile invoices" }] };
        }
        if (name === "start_run") return "operate_run_2";
        return {};
      });
      const work = createOperateWork({
        prisma,
        pool,
        events: createThreadEvents(prisma, new InMemoryRealtimeFanout()),
        jobs: {
          enqueue: vi.fn(async () => {}),
          cancel: vi.fn(async () => {}),
          close: vi.fn(async () => {}),
        },
        credential: async () => ({ endpoint: "https://operate.example/api/mcp", token: "t" }),
        connect: async () => ({ call, close: async () => {} }),
      });
      await work.configure(actor, { botId: bot.id });
      const worker = await prisma.operateWorker.findUniqueOrThrow({ where: { botId: bot.id } });
      await work.tickWorker(worker.id);
      const assignment = await prisma.operateAssignment.findFirstOrThrow({
        where: { workerId: worker.id },
      });
      await prisma.run.update({ where: { id: assignment.runId! }, data: { status: "failed" } });
      calls.length = 0;
      await work.tickWorker(worker.id);
      expect(calls.slice(0, 2)).toEqual(["finish_run", "release_task"]);
      expect(calls).not.toContain("complete_task");
      expect(
        (await prisma.operateAssignment.findUniqueOrThrow({ where: { id: assignment.id } }))
          .reported,
      ).toBe(true);
    } finally {
      await prisma.space.delete({ where: { id: spaceId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  });
});
