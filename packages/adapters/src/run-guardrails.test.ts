import { describe, expect, it } from "vitest";
import {
  advanceRunGuardrail,
  boundedLimit,
  isBudgetGuardrail,
  maxRunDurationMs,
  maxRunSegments,
  maxRunTokens,
  maxToolCallsPerTurn,
  RunGuardrailError,
  routinePausesOnGuardrail,
  unattendedWaitMs,
} from "./run-guardrails.js";

describe("run guardrails", () => {
  it("does not count argument-less observation calls as a loop", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 40; i++) {
      state = advanceRunGuardrail(state, "browser_observe", {}, "routine");
      state = advanceRunGuardrail(
        state,
        "browser_act",
        { action: "click", ref: `r${i}`, snapshotId: `s${i}` },
        "routine",
      );
    }
    expect(state?.count).toBe(80);
    expect(state?.recent).toHaveLength(24);
  });
  it("classifies guardrails so only automation abuse pauses a schedule", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 5; i++) state = advanceRunGuardrail(state, "shell", { a: 1 }, "routine");
    const loop = capture(() => advanceRunGuardrail(state, "shell", { a: 1 }, "routine"));
    expect(loop).toBeInstanceOf(RunGuardrailError);
    expect((loop as RunGuardrailError).kind).toBe("loop");
    expect(routinePausesOnGuardrail(loop)).toBe(false);

    const abuse = capture(() => advanceRunGuardrail(null, "spawn_bot", {}, "routine"));
    expect((abuse as RunGuardrailError).kind).toBe("abuse");
    expect(routinePausesOnGuardrail(abuse)).toBe(true);

    let full: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 200; i++) full = advanceRunGuardrail(full, "fetch", { page: i }, "user");
    const budget = capture(() => advanceRunGuardrail(full, "fetch", { page: 200 }, "user"));
    expect((budget as RunGuardrailError).kind).toBe("budget");
    expect(isBudgetGuardrail(budget)).toBe(true);
    expect(routinePausesOnGuardrail(new Error("plain"))).toBe(false);
  });
  it("lets unattended runs continue across budget segments and keeps attended runs to one", () => {
    expect(maxRunSegments("routine", {})).toBe(6);
    expect(maxRunSegments("webhook", {})).toBe(6);
    expect(maxRunSegments("user", {})).toBe(1);
    expect(maxRunSegments("follow_up", {})).toBe(1);
    expect(maxRunSegments("routine", { MAX_RUN_SEGMENTS: "100" })).toBe(24);
    expect(maxRunSegments("user", { MAX_ATTENDED_RUN_SEGMENTS: "3" })).toBe(3);
    expect(unattendedWaitMs({})).toBe(30 * 60_000);
  });
  it("keeps finite defaults when configuration is missing, zero, negative or invalid", () => {
    for (const raw of [undefined, "", "0", "-1", "NaN", "Infinity", "0.5"]) {
      expect(maxToolCallsPerTurn({ MAX_TOOL_CALLS_PER_TURN: raw })).toBe(200);
    }
    expect(maxToolCallsPerTurn({ MAX_TOOL_CALLS_PER_TURN: "999999" })).toBe(1000);
    expect(maxRunDurationMs({})).toBe(1_200_000);
    expect(maxRunTokens({})).toBe(500_000);
    expect(boundedLimit("12.9", 200, 1000)).toBe(12);
  });
  it("blocks the sixth identical call before execution, including reordered object keys", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 5; i++)
      state = advanceRunGuardrail(state, "shell", { a: 1, b: { c: 2 } }, "user");
    expect(() => advanceRunGuardrail(state, "shell", { b: { c: 2 }, a: 1 }, "user")).toThrow(
      "repeated",
    );
  });
  it("detects alternating loops without storing arguments", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 10; i++)
      state = advanceRunGuardrail(
        state,
        "fetch",
        { credential: "private-value", page: i % 2 },
        "user",
      );
    expect(JSON.stringify(state)).not.toContain("private-value");
    expect(() =>
      advanceRunGuardrail(state, "fetch", { page: 0, credential: "private-value" }, "user"),
    ).toThrow("repeated");
  });
  it("allows pagination but stops at the total budget", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 200; i++) state = advanceRunGuardrail(state, "fetch", { page: i }, "user");
    expect(state?.recent).toHaveLength(24);
    expect(() => advanceRunGuardrail(state, "fetch", { page: 200 }, "user")).toThrow("200-tool");
  });
  it.each(["routine", "bot_message", "spawn", "webhook"])(
    "prevents %s turns from creating new wakeups",
    (trigger) => {
      for (const name of ["spawn_bot", "create_group", "schedule_create"]) {
        expect(() => advanceRunGuardrail(null, name, {}, trigger)).toThrow("direct user request");
      }
      expect(advanceRunGuardrail(null, "message_bot", { target: "peer" }, trigger).count).toBe(1);
    },
  );
  it("bounds persistent automation fan-out even with unique arguments", () => {
    let state: ReturnType<typeof advanceRunGuardrail> | undefined;
    for (let i = 0; i < 4; i++)
      state = advanceRunGuardrail(state, "spawn_bot", { name: `Bot ${i}` }, "user");
    expect(() => advanceRunGuardrail(state, "spawn_bot", { name: "one more" }, "user")).toThrow(
      "per-run limit",
    );
  });
  it("fails closed for malformed persisted state", () => {
    for (const state of [
      {},
      { count: -1, recent: [], automation: {} },
      { count: 0, recent: [12], automation: {} },
    ]) {
      expect(() => advanceRunGuardrail(state, "shell", {}, "user")).toThrow("invalid");
    }
  });
});

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}
