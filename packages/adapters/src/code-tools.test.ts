import { toolRequiresApproval } from "@cadre/core";
import { describe, expect, it } from "vitest";
import {
  CODE_TOOL_NAMES,
  codeDeviceRequest,
  codeToolResult,
  deviceHasCode,
  findCodeDevice,
  runCodeTool,
} from "./code-tools.js";
import { MemoryDeviceRelay } from "./device-relay.js";
import { selectBuiltinToolsForRun } from "./executor.js";

const base = {
  graphicalToolsAllowed: true,
  groupId: null,
  trigger: "message",
  semanticMemoryEnabled: false,
};

describe("code tool registration", () => {
  it("only offers the tools when a code-capable device is online", () => {
    const names = (allowed?: boolean) =>
      selectBuiltinToolsForRun({ ...base, codeToolsAllowed: allowed }).map((tool) => tool.name);
    expect(names()).not.toContain("code_start");
    for (const name of CODE_TOOL_NAMES) expect(names(true)).toContain(name);
  });

  it("requires approval for tools that change code", () => {
    expect(toolRequiresApproval("code_start", false)).toBe(true);
    expect(toolRequiresApproval("code_message", false)).toBe(true);
    expect(toolRequiresApproval("code_status", false)).toBe(false);
  });

  it("detects the capability", () => {
    expect(deviceHasCode({ code: true })).toBe(true);
    expect(deviceHasCode({ code: true, permissions: { code: false } })).toBe(false);
    expect(deviceHasCode({ exec: true })).toBe(false);
    expect(deviceHasCode(null)).toBe(false);
  });
});

describe("code tool device ops", () => {
  it("maps each tool to a code op", () => {
    expect(
      codeDeviceRequest(
        "code_start",
        { project: " ~/app ", task: "fix it", team: { workers: 3 } },
        { id: "b1", name: "Ada" },
      ).request,
    ).toEqual({
      op: "code",
      action: "start",
      project: "~/app",
      task: "fix it",
      bot: { id: "b1", name: "Ada" },
      team: { workers: 3 },
    });
    expect(codeDeviceRequest("code_status", { sessionId: "s", waitSeconds: 99 })).toEqual({
      request: { op: "code", action: "status", sessionId: "s", waitMs: 45000 },
      timeoutMs: 75000,
    });
    expect(codeDeviceRequest("code_message", { sessionId: "s", message: "m" }).request).toEqual({
      op: "code",
      action: "message",
      sessionId: "s",
      message: "m",
    });
    expect(codeDeviceRequest("code_diff", { sessionId: "s" }).request.action).toBe("diff");
    expect(codeDeviceRequest("code_abort", { sessionId: "s" }).request.action).toBe("abort");
  });

  it("rejects bad arguments", () => {
    expect(() => codeDeviceRequest("code_start", { project: "p" })).toThrow("task");
    expect(() =>
      codeDeviceRequest("code_start", { project: "p", task: "t", team: { workers: 99 } }),
    ).toThrow();
    expect(() => codeDeviceRequest("code_status", {})).toThrow("sessionId");
  });

  it("summarizes state, last text and changed files", () => {
    const result = codeToolResult("code_status", {
      sessionId: "s1",
      state: "idle",
      lastAssistantText: "Done.",
      changedFiles: [{ path: "a.ts", status: "M", additions: 3, deletions: 1 }],
    });
    expect(result).toMatchObject({ kind: "agent_tool_result" });
    const text = (result as { content: { text: string }[] }).content[0]?.text;
    expect(text).toContain("State: idle");
    expect(text).toContain("Done.");
    expect(text).toContain("M a.ts (+3 -1)");
    expect(codeToolResult("code_diff", { diff: "" })).toMatchObject({
      content: [{ text: expect.stringContaining("No changes.") }],
    });
    expect(codeToolResult("code_status", { error: "no session" })).toEqual({ error: "no session" });
  });
});

describe("code device lookup and relay", () => {
  function fakes() {
    const rows = [
      { id: "d1", name: "Mac", capabilities: { exec: true }, lastSeenAt: new Date(3) },
      { id: "d2", name: "Linux", capabilities: { code: true }, lastSeenAt: new Date(2) },
      { id: "d3", name: "Old", capabilities: { code: true }, lastSeenAt: new Date(1) },
    ];
    const prisma = { device: { findMany: async () => rows }, bot: {} } as never;
    const relay = new MemoryDeviceRelay();
    return { prisma, relay };
  }

  it("finds no device when none is online", async () => {
    const { prisma, relay } = fakes();
    expect(await findCodeDevice({ prisma, relay }, "u1")).toBeNull();
  });

  it("prefers the bot's device and skips devices without code", async () => {
    const { prisma, relay } = fakes();
    for (const id of ["d1", "d2", "d3"]) await relay.attach(id, { send() {}, close() {} });
    expect(await findCodeDevice({ prisma, relay }, "u1")).toEqual({ id: "d2", name: "Linux" });
    expect(await findCodeDevice({ prisma, relay }, "u1", "d3")).toEqual({ id: "d3", name: "Old" });
  });

  it("sends the op through the relay and formats the answer", async () => {
    const relay = new MemoryDeviceRelay();
    const seen: unknown[] = [];
    await relay.attach("d2", {
      send(message) {
        seen.push(message.request);
        void relay.respond("d2", {
          id: message.id,
          ok: true,
          result: { sessionId: "s9", state: "running", project: "app" },
        });
      },
      close() {},
    });
    const result = await runCodeTool({ relay }, { id: "d2" }, "code_start", {
      project: "app",
      task: "do it",
    });
    expect(seen).toEqual([{ op: "code", action: "start", project: "app", task: "do it" }]);
    expect((result as { content: { text: string }[] }).content[0]?.text).toContain("s9");
  });
});
