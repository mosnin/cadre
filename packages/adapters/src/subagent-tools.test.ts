import {
  CHILD_DENIED_TOOL_NAMES,
  CODE_DELEGATION_TOOL_NAMES,
  COMPUTER_TOOL_NAMES,
  SPAWN_TOOL_NAMES,
  toolRequiresApproval,
} from "@cadre/core";
import { describe, expect, it } from "vitest";
import {
  agentConnectionTools,
  builtinAgentTools,
  DELEGATION_TOOL_NAMES,
  SUBAGENT_PARENT_TOOL_NAMES,
} from "./builtin-tools.js";
import { narrowToolsForSubagent } from "./executor.js";
import { createFakeDb } from "./subagents-fake.js";

const builtinNames = new Set(builtinAgentTools.map((tool) => tool.name));
const tools = builtinAgentTools.map((tool) => ({ name: tool.name, readOnly: tool.readOnly }));

describe("sub-agent tool definitions", () => {
  it("defines every spawn tool, none colliding with existing names", () => {
    const counts = new Map<string, number>();
    for (const tool of builtinAgentTools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    for (const name of SPAWN_TOOL_NAMES) {
      expect(counts.get(name)).toBe(1);
      expect(DELEGATION_TOOL_NAMES.has(name)).toBe(true);
      // The in-turn helper must not be able to spawn further agents.
      expect(SUBAGENT_PARENT_TOOL_NAMES.has(name)).toBe(true);
      expect(toolRequiresApproval(name, false)).toBe(false);
    }
    const spawn = builtinAgentTools.find((tool) => tool.name === "spawn_agent")!;
    expect(spawn.description).toContain("sees ONLY");
    expect(spawn.description).toContain("several times in one turn");
    expect(spawn.inputSchema).toMatchObject({ required: ["description", "prompt"] });
  });

  it("agent type tool lists only name tools that exist", () => {
    for (const name of [...COMPUTER_TOOL_NAMES, ...CODE_DELEGATION_TOOL_NAMES]) {
      expect(builtinNames.has(name), name).toBe(true);
    }
    const known = new Set([
      ...builtinNames,
      ...agentConnectionTools.map((tool) => tool.name),
      "delete_bot",
    ]);
    for (const name of CHILD_DENIED_TOOL_NAMES) expect(known.has(name), name).toBe(true);
  });
});

describe("narrowToolsForSubagent", () => {
  it("narrows through every ancestor and strips spawn tools at the depth limit", async () => {
    const db = createFakeDb();
    const root = db.addRun({ status: "running" });
    const general = db.addRun({
      trigger: "subagent",
      agentType: "general",
      subagentDepth: 1,
      parentRunId: root.id,
      rootRunId: root.id,
    });
    const researcher = db.addRun({
      trigger: "subagent",
      agentType: "researcher",
      subagentDepth: 2,
      parentRunId: general.id,
      rootRunId: root.id,
    });
    const first = await narrowToolsForSubagent(
      db.prisma as never,
      general as never,
      undefined,
      tools,
    );
    if ("error" in first) throw new Error(first.error);
    const firstNames = first.tools.map((tool) => tool.name);
    expect(firstNames).toContain("spawn_agent");
    expect(firstNames).toContain("shell");
    expect(firstNames).not.toContain("message_user");

    const second = await narrowToolsForSubagent(
      db.prisma as never,
      researcher as never,
      undefined,
      tools,
    );
    if ("error" in second) throw new Error(second.error);
    const secondNames = second.tools.map((tool) => tool.name);
    expect(secondNames).toContain("web_fetch");
    expect(secondNames).not.toContain("shell");
    expect(secondNames).not.toContain("spawn_agent");
    // Everything the child holds, its parent held.
    for (const name of secondNames) expect(firstNames).toContain(name);
  });

  it("fails clearly when a custom type disappeared", async () => {
    const db = createFakeDb();
    const root = db.addRun({ status: "running" });
    const child = db.addRun({
      trigger: "subagent",
      agentType: "scribe",
      subagentDepth: 1,
      parentRunId: root.id,
      rootRunId: root.id,
    });
    expect(await narrowToolsForSubagent(db.prisma as never, child as never, [], tools)).toEqual({
      error: "Agent type scribe is no longer available.",
    });
    const custom = [{ name: "scribe", description: "d", instructions: "i", tools: ["write_file"] }];
    const ok = await narrowToolsForSubagent(db.prisma as never, child as never, custom, tools);
    expect("tools" in ok && ok.tools.map((tool) => tool.name)).toEqual(["write_file"]);
  });
});
