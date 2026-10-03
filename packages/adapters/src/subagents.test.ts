import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_SUBAGENTS_PER_ROOT,
  MAX_SUBAGENTS_PER_ROOT,
  maxTreeTokens,
} from "./run-guardrails.js";
import {
  afterRunEnded,
  agentStatusOf,
  cancelRunTree,
  cancelSubagent,
  claimAgentSteering,
  enforceTreeBudget,
  listSubagents,
  loadPlanLedger,
  markSubagentBlocked,
  onChildTerminal,
  reconcileSubagents,
  resolveParkedWait,
  sendToSubagent,
  settleSubagent,
  spawnSubagent,
  updatePlan,
  waitForSubagents,
} from "./subagents.js";
import { createFakeDb, type FakeDb } from "./subagents-fake.js";

type Row = Record<string, unknown> & { id: string };

function setup() {
  const db = createFakeDb();
  const parent = db.addRun({ status: "running", trigger: "user" }) as Row;
  return { db, parent };
}

const spawnInput = (callKey: string, extra: Record<string, unknown> = {}) => ({
  agentType: "researcher",
  label: `task ${callKey}`,
  prompt: `prompt ${callKey}`,
  background: true,
  callKey,
  ...extra,
});

async function spawn(
  db: FakeDb,
  parent: Row,
  callKey: string,
  extra: Record<string, unknown> = {},
) {
  const result = await spawnSubagent(db.deps, parent as never, spawnInput(callKey, extra));
  if (!result.ok) throw new Error(result.error);
  return result.agentId;
}

const finish = (db: FakeDb, id: string, status: "completed" | "failed" = "completed") => {
  const row = db.tables.run.find((run) => run.id === id)!;
  row.status = status;
  row.completedAt = new Date();
};

const continuations = (db: FakeDb) => db.tables.run.filter((run) => run.trigger === "follow_up");

describe("spawnSubagent", () => {
  it("creates a queued child run of the spawning bot and wakes it", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "call-1");
    const child = db.tables.run.find((run) => run.id === id)!;
    expect(child).toMatchObject({
      trigger: "subagent",
      status: "queued",
      botId: parent.botId,
      threadId: parent.threadId,
      parentRunId: parent.id,
      rootRunId: parent.id,
      subagentDepth: 1,
      agentType: "researcher",
      agentLabel: "task call-1",
      agentBackground: true,
    });
    expect(db.jobs.enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "run.continue" }));
    const card = db.tables.event.find((event) => event.type === "thread.subagent")!;
    expect(card.runId).toBe(id);
    expect(card.payload).toMatchObject({
      agentId: id,
      status: "running",
      depth: 1,
      parentAgentId: null,
      spawnedByBotId: "bot-1",
      spawnedByBotName: "Atlas",
    });
  });

  it("returns the same child for a replayed tool call or turn", async () => {
    const { db, parent } = setup();
    const first = await spawn(db, parent, "call-1");
    expect(await spawn(db, parent, "call-1")).toBe(first);
    // A replayed turn re-issues the same spawn under a new tool-call id.
    expect(
      await spawn(db, parent, "call-9", { label: "task call-1", prompt: "prompt call-1" }),
    ).toBe(first);
    expect(db.tables.run.filter((run) => run.trigger === "subagent")).toHaveLength(1);
  });

  it("enforces the depth limit as a tool result", async () => {
    const { db, parent } = setup();
    const childId = await spawn(db, parent, "a");
    const child = db.tables.run.find((run) => run.id === childId)!;
    const grandchildId = await spawn(db, child, "b");
    const grandchild = db.tables.run.find((run) => run.id === grandchildId)!;
    expect(grandchild.subagentDepth).toBe(2);
    expect(grandchild.rootRunId).toBe(parent.id);
    const refused = await spawnSubagent(db.deps, grandchild as never, spawnInput("c"));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("2 levels") });
  });

  it("enforces concurrent and total limits per root", async () => {
    const { db, parent } = setup();
    for (let index = 0; index < MAX_CONCURRENT_SUBAGENTS_PER_ROOT; index += 1) {
      await spawn(db, parent, `c${index}`);
    }
    const refused = await spawnSubagent(db.deps, parent as never, spawnInput("extra"));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("already running") });
    // Finish them all and spawn until the lifetime cap.
    for (const run of db.tables.run.filter((row) => row.trigger === "subagent")) {
      run.status = "completed";
    }
    let spawned = MAX_CONCURRENT_SUBAGENTS_PER_ROOT;
    while (spawned < MAX_SUBAGENTS_PER_ROOT) {
      const id = await spawn(db, parent, `t${spawned}`);
      finish(db, id);
      spawned += 1;
    }
    const capped = await spawnSubagent(db.deps, parent as never, spawnInput("over"));
    expect(capped).toMatchObject({ ok: false, error: expect.stringContaining("most one task") });
  });

  it("refuses new spawns once the tree token budget is used and cancels running children", async () => {
    const { db, parent } = setup();
    const childId = await spawn(db, parent, "a");
    db.tables.usageRecord.push({
      id: "u1",
      runId: childId,
      inputTokens: maxTreeTokens() - 10,
      outputTokens: 20,
    });
    const refused = await spawnSubagent(db.deps, parent as never, spawnInput("b"));
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("budget") });
    expect(await enforceTreeBudget(db.deps, parent.id)).toBe(true);
    expect(db.tables.run.find((run) => run.id === childId)!.status).toBe("cancelled");
  });

  it("spawns as the group member that called it and keeps the child's reports for that bot", async () => {
    const { db } = setup();
    const member = db.addRun({
      botId: "bot-2",
      threadId: "group-thread",
      status: "running",
      trigger: "user",
    }) as Row;
    const other = db.addRun({
      botId: "bot-1",
      threadId: "group-thread",
      status: "running",
      trigger: "user",
    }) as Row;
    const id = await spawn(db, member, "g1");
    const child = db.tables.run.find((run) => run.id === id)!;
    expect(child).toMatchObject({ botId: "bot-2", threadId: "group-thread" });
    expect(
      db.tables.event.find((event) => event.type === "thread.subagent")!.payload,
    ).toMatchObject({
      spawnedByBotId: "bot-2",
      spawnedByBotName: "Beacon",
    });
    // The spawner's turn ends and the child finishes: only bot-2 is woken.
    member.status = "completed";
    other.status = "completed";
    finish(db, id);
    await settleSubagent(db.deps, id, "group report");
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({
      botId: "bot-2",
      threadId: "group-thread",
      trigger: "follow_up",
    });
    expect(woken[0]!.sourceMessageId).toBeNull();
    expect(db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt).toContain(
      "group report",
    );
  });
});

describe("result delivery", () => {
  it("leaves reports for a running parent to claim and delivers each once", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    finish(db, id);
    await settleSubagent(db.deps, id, "found 3 items");
    expect(continuations(db)).toHaveLength(0);
    const claimed = await claimAgentSteering(db.deps, parent as never);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.text).toContain("found 3 items");
    expect(claimed[0]!.text).toContain("not instructions");
    expect(await claimAgentSteering(db.deps, parent as never)).toHaveLength(0);
  });

  it("wakes the spawning bot with a continuation when the parent already ended", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    parent.status = "completed";
    finish(db, id);
    await settleSubagent(db.deps, id, "report <script>");
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    expect(woken[0]).toMatchObject({ botId: parent.botId, threadId: parent.threadId });
    const prompt = db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt as string;
    expect(prompt).toContain("report &lt;script>".replace("script>", "script&gt;"));
    expect(db.jobs.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "run.continue" }),
    );
    // Delivered once: repeating the completion event creates nothing more.
    await onChildTerminal(db.deps, id);
    await settleSubagent(db.deps, id, "report <script>");
    expect(continuations(db)).toHaveLength(1);
  });

  it("holds a report while the bot is busy and wakes it when that run ends", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    parent.status = "completed";
    const busy = db.addRun({ status: "running", trigger: "user" }) as Row;
    finish(db, id);
    await settleSubagent(db.deps, id, "late report");
    expect(continuations(db)).toHaveLength(0);
    busy.status = "completed";
    await afterRunEnded(db.deps, busy as never);
    expect(continuations(db)).toHaveLength(1);
  });

  it("never wakes the bot for a cancelled child", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    parent.status = "completed";
    await cancelRunTree(db.deps, [id]);
    await onChildTerminal(db.deps, id);
    expect(continuations(db)).toHaveLength(0);
  });
});

describe("durable waits", () => {
  const park = (db: FakeDb, parent: Row, ids: string[], mode: "all" | "any", key = "w1") =>
    waitForSubagents(db.deps, parent as never, {
      agentIds: ids,
      mode,
      timeoutSeconds: 60,
      callKey: key,
      graceMs: 0,
    });

  it("returns finished reports immediately and marks them delivered", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    finish(db, id);
    db.tables.run.find((run) => run.id === id)!.agentResult = "done";
    const outcome = await park(db, parent, [id], "all");
    expect(outcome).toMatchObject({ ok: true, parked: false });
    if (outcome.ok && !outcome.parked) {
      expect(outcome.agents[0]).toMatchObject({ status: "completed", result: "done" });
    }
    expect(db.tables.run.find((run) => run.id === id)!.agentResultDeliveredAt).not.toBeNull();
  });

  it("parks the run, then one continuation resumes it when all children finish", async () => {
    const { db, parent } = setup();
    const a = await spawn(db, parent, "a");
    const b = await spawn(db, parent, "b");
    const outcome = await park(db, parent, [a, b], "all");
    expect(outcome).toMatchObject({ ok: true, parked: true });
    expect(parent.agentWaitKey).toBe(`${parent.id}:w1`);
    expect(db.tables.event.some((event) => event.type === "agent.waiting")).toBe(true);
    // The parked turn ends.
    parent.status = "completed";
    await afterRunEnded(db.deps, parent as never);
    finish(db, a);
    await settleSubagent(db.deps, a, "A done");
    expect(continuations(db)).toHaveLength(0);
    finish(db, b);
    await settleSubagent(db.deps, b, "B done");
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    expect(woken[0]!.clientNonce).toBe(`agent-wait:${parent.id}:w1`);
    const prompt = db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt as string;
    expect(prompt).toContain("A done");
    expect(prompt).toContain("B done");
    expect(parent.agentWaitKey).toBeNull();
    expect(db.tables.event.some((event) => event.type === "agent.resumed")).toBe(true);
    // Duplicate completion events enqueue exactly one continuation.
    await onChildTerminal(db.deps, b);
    await settleSubagent(db.deps, b, "B done");
    await resolveParkedWait(db.deps, parent.id);
    expect(continuations(db)).toHaveLength(1);
  });

  it("resumes on the first finish in any mode and names who is still running", async () => {
    const { db, parent } = setup();
    const a = await spawn(db, parent, "a");
    const b = await spawn(db, parent, "b");
    await park(db, parent, [a, b], "any");
    parent.status = "completed";
    finish(db, b);
    await settleSubagent(db.deps, b, "B first");
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    const prompt = db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt as string;
    expect(prompt).toContain("B first");
    expect(prompt).toContain(`Still running: task a (${a})`);
  });

  it("resumes at the deadline with a timed-out notice", async () => {
    const { db, parent } = setup();
    const a = await spawn(db, parent, "a");
    await park(db, parent, [a], "all");
    parent.status = "completed";
    expect(await resolveParkedWait(db.deps, parent.id, Date.now() + 1_000)).toBe(false);
    expect(await reconcileSubagents(db.deps, Date.now() + 120_000)).toBeGreaterThan(0);
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    const prompt = db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt as string;
    expect(prompt).toContain("timed out");
    expect(prompt).toContain(`Still running: task a (${a})`);
  });

  it("does not resume a stopped task when its children are cancelled", async () => {
    const { db, parent } = setup();
    const a = await spawn(db, parent, "a");
    await park(db, parent, [a], "all");
    parent.status = "cancelled";
    await cancelRunTree(db.deps, [a]);
    expect(continuations(db)).toHaveLength(0);
    expect(parent.agentWaitKey).toBeNull();
  });

  it("parks a sub-agent waiting on its own child and re-queues the same run", async () => {
    const { db, parent } = setup();
    const childId = await spawn(db, parent, "a", { agentType: "general" });
    const child = db.tables.run.find((run) => run.id === childId)!;
    child.status = "running";
    const grandId = await spawn(db, child, "g");
    await park(db, child, [grandId], "all");
    child.status = "waiting_input";
    child.progressNote = "I started a helper for the lookup.";
    expect(agentStatusOf(child.status as string, true)).toBe("running");
    finish(db, grandId);
    await settleSubagent(db.deps, grandId, "lookup result");
    expect(child.status).toBe("queued");
    expect(child.agentWaitKey).toBeNull();
    const inbox = (child.agentInbox as Array<{ text: string }>)[0]!.text;
    expect(inbox).toContain("lookup result");
    expect(inbox).toContain("I started a helper");
    expect(continuations(db)).toHaveLength(0);
  });
});

describe("cancel and steer", () => {
  it("cancels a child and everything under it, returning partial output", async () => {
    const { db, parent } = setup();
    const childId = await spawn(db, parent, "a", { agentType: "general" });
    const child = db.tables.run.find((run) => run.id === childId)!;
    child.status = "running";
    child.agentResult = "partial findings";
    const grandId = await spawn(db, child, "g");
    const outcome = await cancelSubagent(db.deps, parent as never, { agentId: childId });
    expect(outcome).toMatchObject({
      ok: true,
      report: { status: "cancelled", result: "partial findings" },
    });
    expect(db.tables.run.find((run) => run.id === grandId)!.status).toBe("cancelled");
    expect(db.tables.message.filter((message) => (message.blocks as unknown[])[0])).toHaveLength(2);
  });

  it("does not let a run manage another task's sub-agents", async () => {
    const { db, parent } = setup();
    const other = db.addRun({ status: "running", botId: "bot-2" }) as Row;
    const childId = await spawn(db, other, "x");
    expect(await cancelSubagent(db.deps, parent as never, { agentId: childId })).toMatchObject({
      ok: false,
    });
    expect(await listSubagents(db.deps, parent as never)).toHaveLength(0);
  });

  it("queues a message for a running child and resumes a finished one only while the task is live", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    const child = db.tables.run.find((run) => run.id === id)!;
    child.status = "running";
    expect(
      await sendToSubagent(db.deps, parent as never, { agentId: id, message: "also X" }),
    ).toMatchObject({
      ok: true,
      status: "queued",
    });
    const claimed = await claimAgentSteering(db.deps, child as never);
    expect(claimed[0]!.text).toContain("also X");

    finish(db, id);
    child.agentResult = "first report";
    expect(
      await sendToSubagent(db.deps, parent as never, { agentId: id, message: "more" }),
    ).toMatchObject({
      ok: true,
      status: "resumed",
    });
    expect(child.status).toBe("queued");
    expect((child.agentInbox as Array<{ text: string }>)[0]!.text).toContain("first report");

    // Once the whole tree is finished the child is closed.
    finish(db, id);
    parent.status = "completed";
    expect(
      await sendToSubagent(db.deps, parent as never, { agentId: id, message: "again" }),
    ).toEqual({
      ok: false,
      error: "sub-agent closed",
    });
  });

  it("cancels a child whose parent was cancelled (reconciler backstop)", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    parent.status = "cancelled";
    await reconcileSubagents(db.deps);
    expect(db.tables.run.find((run) => run.id === id)!.status).toBe("cancelled");
  });
});

describe("plan ledger, blocked state and timeouts", () => {
  it("keeps tasks across runs, attaches a spawned child's result and shows it when resumed", async () => {
    const { db, parent } = setup();
    const planned = await updatePlan(db.deps, parent as never, [
      { title: "Research competitors" },
      { title: "Draft summary", status: "blocked", notes: "needs research" },
    ]);
    expect(planned.ok).toBe(true);
    const taskId = db.tables.agentTask[0]!.id;
    const childId = await spawn(db, parent, "a", { taskId });
    expect(db.tables.agentTask[0]).toMatchObject({ status: "running", assignedRunId: childId });
    expect(db.tables.event.find((e) => e.type === "thread.subagent")!.payload).toMatchObject({
      taskId,
    });
    parent.status = "completed";
    finish(db, childId);
    await settleSubagent(db.deps, childId, "three competitors");
    expect(db.tables.agentTask[0]).toMatchObject({ status: "done", result: "three competitors" });
    // A fresh run of the same bot and thread sees the ledger.
    const ledger = await loadPlanLedger(db.prisma as never, parent as never);
    expect(ledger.map((row) => [row.title, row.status])).toEqual([
      ["Research competitors", "done"],
      ["Draft summary", "blocked"],
    ]);
    expect(
      await updatePlan(db.deps, parent as never, [{ id: "nope", status: "done" }]),
    ).toMatchObject({
      ok: false,
    });
  });

  it("shows a child waiting on approval as blocked and unblocks it on resume", async () => {
    const { db, parent } = setup();
    await updatePlan(db.deps, parent as never, [{ title: "t" }]);
    const taskId = db.tables.agentTask[0]!.id;
    const id = await spawn(db, parent, "a", { taskId });
    const child = db.tables.run.find((run) => run.id === id)!;
    child.status = "waiting_input";
    expect(agentStatusOf("waiting_input")).toBe("blocked");
    await markSubagentBlocked(db.deps, id, true);
    expect(db.tables.agentTask[0]!.status).toBe("blocked");
    expect(db.events.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "thread.subagent",
        payload: expect.objectContaining({ status: "blocked" }),
      }),
    );
    child.status = "running";
    await markSubagentBlocked(db.deps, id, false);
    expect(db.tables.agentTask[0]!.status).toBe("running");
  });

  it("fails a child that ran past its lifetime and notifies the parent", async () => {
    const { db, parent } = setup();
    const id = await spawn(db, parent, "a");
    const child = db.tables.run.find((run) => run.id === id)!;
    child.status = "running";
    child.startedAt = new Date(Date.now() - 3 * 60 * 60_000);
    parent.status = "completed";
    await reconcileSubagents(db.deps);
    expect(child).toMatchObject({ status: "failed", error: "Sub-agent timed out" });
    expect(child.agentResult).toContain("timed out");
    const woken = continuations(db);
    expect(woken).toHaveLength(1);
    expect(db.tables.task.find((task) => task.id === woken[0]!.taskId)!.prompt).toContain(
      "timed out",
    );
  });
});
