import type { ThreadMessage } from "@cadre/contracts";
import { describe, expect, it } from "vitest";
import {
  agentNameIssue,
  agentTypesValid,
  flattenSubagents,
  formatTokens,
  groupSubagentMessages,
  normalizeAgentTypes,
  subagentCounts,
  toPlanItems,
  toSubagentView,
} from "./subagents";

const view = (agentId: string, extra: Record<string, unknown> = {}) =>
  toSubagentView({
    kind: "subagent",
    agentId,
    name: agentId,
    task: "t",
    status: "running",
    ...extra,
  });

function message(id: string, blocks: unknown[], runId = "run-1"): ThreadMessage {
  return {
    id,
    threadId: "thread-1",
    seq: 1,
    role: "bot",
    blocks,
    botId: "bot-1",
    runId,
    createdAt: "2026-09-03T21:29:52.000Z",
  } as ThreadMessage;
}

describe("sub-agent projection", () => {
  it("tolerates legacy blocks and unknown statuses", () => {
    const legacy = toSubagentView({ agentId: "a", name: "A", task: "t", status: "completed" });
    expect(legacy.status).toBe("completed");
    expect(legacy.parentAgentId).toBeUndefined();
    expect(legacy.steps).toBeUndefined();
    expect(toSubagentView({ agentId: "a", status: "paused" }).status).toBe("paused");
    expect(toSubagentView({ agentId: "a" }).status).toBe("running");
    const full = view("a", {
      status: "cancelled",
      parentAgentId: null,
      depth: 1,
      agentType: "coder",
      usage: { inputTokens: 900, outputTokens: 300 },
      steps: [{ label: "Shell", count: 2 }, { nope: true }],
    });
    expect(full).toMatchObject({ status: "cancelled", parentAgentId: null, agentType: "coder" });
    expect(full.steps).toEqual([{ label: "Shell", count: 2 }]);
    expect(formatTokens(full.usage)).toBe("1.2k");
  });

  it("nests children under their parent and treats unknown parents as roots", () => {
    const rows = flattenSubagents([
      view("a"),
      view("c", { parentAgentId: "b" }),
      view("b", { parentAgentId: "a" }),
      view("orphan", { parentAgentId: "missing" }),
      view("loop", { parentAgentId: "loop" }),
    ]);
    expect(rows.map((row) => [row.agent.agentId, row.level])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["orphan", 0],
      ["loop", 0],
    ]);
  });

  it("counts running and finished agents", () => {
    expect(
      subagentCounts([view("a"), view("b", { status: "failed" }), view("c", { status: "x" })]),
    ).toEqual({
      running: 1,
      done: 2,
      blocked: 0,
    });
  });

  it("groups consecutive sub-agent messages of one run", () => {
    const sub = (id: string, extra = {}) =>
      message(`subagent:${id}`, [
        { kind: "subagent", agentId: id, name: id, task: "t", status: "running", ...extra },
      ]);
    const { groups, hidden } = groupSubagentMessages([
      message("text-1", [{ kind: "text", text: "hi" }]),
      sub("a"),
      sub("b", { parentAgentId: "a" }),
      message("steps", [{ kind: "steps", steps: [{ label: "Shell", count: 1 }] }]),
      sub("c"),
      message("text-2", [{ kind: "text", text: "next" }]),
      sub("d"),
    ]);
    expect([...groups.keys()]).toEqual(["subagent:a", "subagent:d"]);
    expect(groups.get("subagent:a")?.map((agent) => agent.agentId)).toEqual(["a", "b", "c"]);
    expect([...hidden]).toEqual(["subagent:b", "subagent:c"]);
  });
});

describe("agent type editing", () => {
  it("validates names, duplicates and the limit", () => {
    const agent = (name: string) => ({ name, description: "", instructions: "" });
    expect(agentNameIssue("data-analyst", [agent("data-analyst")])).toBeUndefined();
    expect(agentNameIssue("A", [])).toBe("name-invalid");
    expect(agentNameIssue("1ab", [])).toBe("name-invalid");
    expect(agentNameIssue("a", [])).toBe("name-invalid");
    expect(agentNameIssue("ab", [agent("ab"), agent("ab")])).toBe("name-duplicate");
    expect(agentTypesValid(Array.from({ length: 13 }, (_, i) => agent(`ag-${i}`)))).toBe(false);
    expect(agentTypesValid([agent("ab")])).toBe(true);
  });

  it("drops empty optional fields", () => {
    expect(
      normalizeAgentTypes([
        { name: " ab ", description: " d ", instructions: "i", tools: ["", "x "], model: " " },
      ]),
    ).toEqual([{ name: "ab", description: "d", instructions: "i", tools: ["x"] }]);
  });
});

describe("spawner grouping", () => {
  it("splits groups by spawning bot", () => {
    const sub = (id: string, spawnedByBotId: string) =>
      message(`subagent:${id}`, [
        { kind: "subagent", agentId: id, name: id, task: "t", status: "running", spawnedByBotId },
      ]);
    const { groups } = groupSubagentMessages([
      sub("a", "bot-1"),
      sub("b", "bot-1"),
      sub("c", "bot-2"),
    ]);
    expect([...groups.keys()]).toEqual(["subagent:a", "subagent:c"]);
    expect(groups.get("subagent:a")?.length).toBe(2);
  });
});

describe("blocked agents and plans", () => {
  it("counts blocked agents as active", () => {
    expect(
      subagentCounts([view("a", { status: "blocked" }), view("b", { status: "interrupted" })]),
    ).toEqual({
      running: 1,
      done: 1,
      blocked: 1,
    });
  });

  it("reads plan items defensively", () => {
    expect(toPlanItems({ kind: "plan" })).toEqual([]);
    expect(
      toPlanItems({
        items: [
          { id: "1", title: "Research", status: "running", agentId: "a" },
          { title: "Write" },
          5,
          {},
        ],
      }),
    ).toEqual([
      { id: "1", title: "Research", status: "running", agentId: "a" },
      { id: "1", title: "Write", status: "pending", agentId: undefined },
    ]);
  });
});
