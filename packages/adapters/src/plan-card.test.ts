import { describe, expect, it, vi } from "vitest";

vi.mock("@cadre/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cadre/db")>();
  return {
    ...actual,
    appendEventInTransaction: vi.fn(async (_tx: unknown, input: { type: string }) => ({
      seq: input.type === "thread.message.updated" ? 2 : 1,
    })),
    createThreadMessageInTransaction: vi.fn(async (tx: FakeTx, input: { blocks: unknown[] }) => {
      const message = { id: `m${tx.messages.length + 1}`, blocks: input.blocks };
      tx.messages.unshift(message);
      return message;
    }),
  };
});

const { publishPlanCard } = await import("./subagents.js");

interface FakeTx {
  messages: Array<{ id: string; blocks: unknown }>;
  message: {
    findMany: () => Promise<Array<{ id: string; blocks: unknown }>>;
    update: (args: { where: { id: string }; data: { blocks: unknown } }) => Promise<void>;
  };
}

function fakeDeps() {
  const tx: FakeTx = {
    messages: [],
    message: {
      findMany: async () => tx.messages,
      update: async ({ where, data }) => {
        const row = tx.messages.find((m) => m.id === where.id);
        if (row) row.blocks = data.blocks;
      },
    },
  };
  const notify = vi.fn(async () => undefined);
  const deps = {
    prisma: { $transaction: async (fn: (t: FakeTx) => Promise<number>) => fn(tx) },
    events: { notify },
  };
  return { deps: deps as never, tx, notify };
}

const run = { id: "r1", spaceId: "s1", threadId: "t1", botId: "b1" };

describe("publishPlanCard", () => {
  it("creates one card, updates it while tasks are open, and starts a new card after it finishes", async () => {
    const { deps, tx, notify } = fakeDeps();
    await publishPlanCard(deps, run, [
      { id: "a", title: "Research", status: "running", assignedRunId: "c1" },
    ]);
    expect(tx.messages).toHaveLength(1);
    expect(tx.messages[0]?.blocks).toEqual([
      { kind: "plan", items: [{ id: "a", title: "Research", status: "running", agentId: "c1" }] },
    ]);

    await publishPlanCard(deps, run, [{ id: "a", title: "Research", status: "done" }]);
    expect(tx.messages).toHaveLength(1);
    expect(tx.messages[0]?.blocks).toEqual([
      { kind: "plan", items: [{ id: "a", title: "Research", status: "done" }] },
    ]);

    await publishPlanCard(deps, run, [{ id: "b", title: "Write", status: "pending" }]);
    expect(tx.messages).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(3);
  });
});
