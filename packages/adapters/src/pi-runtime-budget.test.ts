import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
  budgetStopReason,
  consumeTokens,
  contextCharBudget,
  pruneOldToolResultContext,
  truncateToolResult,
} from "./pi-runtime.js";
import { RunGuardrailError } from "./run-guardrails.js";

function toolResult(name: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `${name}-${text.length}`,
    toolName: name,
    content: [{ type: "text", text }],
    timestamp: 0,
  } as AgentMessage;
}

describe("run token budget", () => {
  it("charges generated output plus the largest request context, not every re-sent prompt", () => {
    let aborted = 0;
    const host = {
      tokenBudget: { count: 0, limit: 100_000, exceeded: false },
      abortTurn: () => {
        aborted += 1;
      },
    };
    for (let turn = 0; turn < 20; turn++) {
      consumeTokens(host, { input: 40_000, cacheRead: 0, output: 500 });
    }
    expect(host.tokenBudget.count).toBe(40_000 + 20 * 500);
    expect(host.tokenBudget.exceeded).toBe(false);
    expect(aborted).toBe(0);
    consumeTokens(host, { input: 95_000, output: 100 });
    expect(host.tokenBudget.exceeded).toBe(true);
    expect(aborted).toBe(1);
  });

  it("names the budget that ended a segment", () => {
    const controller = new AbortController();
    const host = {
      tokenBudget: { count: 0, limit: 1, exceeded: false },
      toolCallBudget: { count: 0, limit: 200, exceeded: false },
    };
    expect(budgetStopReason(controller.signal, host)).toBeNull();
    controller.abort(new RunGuardrailError("Run time limit reached.", "budget"));
    expect(budgetStopReason(controller.signal, host)).toBe("Run time limit reached.");
    const loop = new AbortController();
    loop.abort(new RunGuardrailError("loop", "loop"));
    expect(budgetStopReason(loop.signal, host)).toBeNull();
    host.toolCallBudget.exceeded = true;
    expect(budgetStopReason(loop.signal, host)).toContain("200 tool calls");
  });
});

describe("in-run context pruning", () => {
  it("trims the oldest tool results first and keeps recent ones whole", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "do the task", timestamp: 0 } as AgentMessage,
      ...Array.from({ length: 10 }, (_, i) => toolResult(`read_${i}`, "x".repeat(5_000))),
    ];
    const pruned = pruneOldToolResultContext(messages, 20_000, 2);
    expect(pruned).not.toBe(messages);
    expect(pruned[0]).toEqual(messages[0]);
    const text = (index: number) =>
      (pruned[index] as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text(1)).toContain("older tool result trimmed");
    expect(text(1).length).toBeLessThan(500);
    expect(text(10)).toBe("x".repeat(5_000));
    expect(text(9)).toBe("x".repeat(5_000));
    const total = pruned.reduce(
      (sum, message) =>
        sum + (message as { content: Array<{ text?: string }> | string }).content.length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("leaves a transcript that fits untouched", () => {
    const messages = [toolResult("a", "short")];
    expect(pruneOldToolResultContext(messages, 1_000)).toBe(messages);
  });

  it("derives the budget from the model window with a reply reserve", () => {
    expect(contextCharBudget({ contextWindow: 200_000 })).toBe(Math.floor(200_000 * 3.5 * 0.65));
    expect(contextCharBudget({ contextWindow: Number.NaN })).toBe(
      Math.floor(128_000 * 3.5 * 0.65),
    );
  });
});

describe("tool result truncation", () => {
  it("keeps every field of a large snapshot and marks what was cut", () => {
    const snapshot = {
      url: "https://example.test/listings",
      snapshotId: "snap-1",
      elements: Array.from({ length: 300 }, (_, i) => ({ ref: `e${i}`, role: "link", name: `Item ${i}` })),
      text: "page text ".repeat(2_000),
    };
    const trimmed = truncateToolResult(snapshot, 12_000) as Record<string, unknown>;
    const json = JSON.stringify(trimmed);
    expect(json.length).toBeLessThan(13_500);
    expect(trimmed.url).toBe(snapshot.url);
    expect(trimmed.snapshotId).toBe("snap-1");
    expect(trimmed.truncated).toBe(true);
    expect(String(trimmed.text)).toContain("[truncated");
    const elements = trimmed.elements as unknown[];
    expect(elements.length).toBeGreaterThan(10);
    expect(String(elements.at(-1))).toContain("more items omitted");
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("returns small values unchanged", () => {
    const small = { ok: true, items: [1, 2, 3] };
    expect(truncateToolResult(small, 12_000)).toBe(small);
  });
});
