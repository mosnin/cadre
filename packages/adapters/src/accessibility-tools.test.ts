import { describe, expect, it } from "vitest";
import {
  ACCESSIBILITY_TOOL_NAMES,
  accessibilityAgentTools,
  accessibilityRequest,
  accessibilityToolResult,
  deviceHasAccessibility,
} from "./accessibility-tools.js";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectBuiltinToolsForRun } from "./executor.js";

const base = {
  graphicalToolsAllowed: true,
  browserToolsAllowed: true,
  groupId: null,
  trigger: "user",
  semanticMemoryEnabled: false,
};

describe("accessibility tool registration", () => {
  it("is part of the builtin catalog but only selected when the computer reports it", () => {
    for (const name of ACCESSIBILITY_TOOL_NAMES) {
      expect(builtinAgentTools.some((tool) => tool.name === name)).toBe(true);
    }
    const without = selectBuiltinToolsForRun(base).map((tool) => tool.name);
    const withAx = selectBuiltinToolsForRun({ ...base, accessibilityToolsAllowed: true }).map(
      (tool) => tool.name,
    );
    expect(without.filter((name) => ACCESSIBILITY_TOOL_NAMES.has(name))).toEqual([]);
    expect(withAx.filter((name) => ACCESSIBILITY_TOOL_NAMES.has(name)).sort()).toEqual(
      [...ACCESSIBILITY_TOOL_NAMES].sort(),
    );
    expect(accessibilityAgentTools).toHaveLength(9);
  });

  it("requires accessibility and its permission", () => {
    expect(deviceHasAccessibility({ accessibility: true })).toBe(true);
    expect(
      deviceHasAccessibility({ accessibility: true, permissions: { accessibility: false } }),
    ).toBe(false);
    expect(deviceHasAccessibility({ screen: true })).toBe(false);
    expect(deviceHasAccessibility(null)).toBe(false);
  });
});

describe("accessibility requests", () => {
  it("maps tools and stringifies element indexes", () => {
    expect(accessibilityRequest("computer_apps", { junk: 1 })).toEqual({
      tool: "list_apps",
      args: {},
    });
    expect(
      accessibilityRequest("computer_click_element", { app: "Notes", element_index: 4, extra: 1 }),
    ).toEqual({ tool: "click", args: { app: "Notes", element_index: "4" } });
    expect(accessibilityRequest("computer_click_element", { app: "Notes", x: 1, y: 2 })).toEqual({
      tool: "click",
      args: { app: "Notes", x: 1, y: 2 },
    });
  });

  it("rejects missing arguments", () => {
    expect(() => accessibilityRequest("computer_type", { app: "Notes" })).toThrow(/text/);
    expect(() => accessibilityRequest("computer_click_element", { app: "Notes" })).toThrow(
      /element_index/,
    );
  });
});

describe("accessibility results", () => {
  it("keeps screenshots as image content", () => {
    const result = accessibilityToolResult("computer_app_state", {
      content: [
        { type: "text", text: "0 window" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
    expect(result).toMatchObject({
      kind: "agent_tool_result",
      content: [
        { type: "text", text: "0 window" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
      ],
    });
  });

  it("turns device errors into tool errors", () => {
    expect(
      accessibilityToolResult("computer_key", {
        content: [{ type: "text", text: "no such app" }],
        isError: true,
      }),
    ).toEqual({ error: "no such app" });
  });
});
