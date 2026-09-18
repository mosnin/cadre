import { describe, expect, it, vi } from "vitest";
import {
  type BrowserElement,
  browserActionSpace,
  MAX_PURSUIT_STEPS,
  planBrowserAction,
  pursueBrowserGoal,
} from "./decision-browser.js";
import type { DecisionProvider } from "./jev-decisions.js";

const ELEMENTS: BrowserElement[] = [
  { ref: "e1", role: "button", name: "Search" },
  { ref: "e2", role: "textbox", name: "Where from?" },
  { ref: "e3", role: "link", name: "Help" },
  { ref: "e4", role: "button", name: "Disabled", disabled: true },
];

function provider(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

describe("the browser action space", () => {
  it("offers only the operations each control supports, and skips disabled ones", () => {
    const { targets, table } = browserActionSpace(ELEMENTS);
    expect(table.map((row) => row.index)).toEqual(["e1", "e2", "e3"]);
    expect(targets.CLICK?.map((element) => element.ref)).toEqual(["e1", "e2", "e3"]);
    expect(targets.TYPE_TEXT?.map((element) => element.ref)).toEqual(["e2"]);
  });
});

describe("planning the next browser action", () => {
  it("returns nothing without a provider, so the agent decides as it does today", async () => {
    await expect(
      planBrowserAction(undefined, { goal: "g", snapshot: { elements: ELEMENTS } }),
    ).resolves.toBeUndefined();
  });

  it("asks for the operation and every operation's target in one request", async () => {
    const decide = vi.fn(async (_request: unknown) => ({ answers: {}, model: "m" }));
    await planBrowserAction({ decide }, { goal: "find flights", snapshot: { elements: ELEMENTS } });
    expect(decide).toHaveBeenCalledTimes(1);
    const request = decide.mock.calls[0]![0] as unknown as { questions: Record<string, unknown> };
    expect(Object.keys(request.questions).sort()).toEqual([
      "click_target",
      "operation",
      "type_text_target",
    ]);
  });

  it("uses the target matching the chosen operation and ignores the speculative one", async () => {
    const planned = await planBrowserAction(
      provider({
        operation: { type: "choice", choice: "TYPE_TEXT", confidence: 0.9 },
        type_text_target: { type: "choice", choice: "e2", confidence: 0.9 },
        click_target: { type: "choice", choice: "e1", confidence: 0.99 },
      }),
      { goal: "type a city", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toMatchObject({ operation: "TYPE_TEXT", ref: "e2" });
  });

  it("returns a control operation with no target", async () => {
    const planned = await planBrowserAction(
      provider({ operation: { type: "choice", choice: "DONE", confidence: 0.95 } }),
      { goal: "g", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toEqual({ operation: "DONE" });
  });

  it("declines rather than acting on a hedged operation", async () => {
    const planned = await planBrowserAction(
      provider({
        operation: { type: "choice", choice: "CLICK", confidence: 0.2 },
        click_target: { type: "choice", choice: "e1", confidence: 0.99 },
      }),
      { goal: "g", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toBeUndefined();
  });

  it("declines when the target is a control the browser never reported", async () => {
    const planned = await planBrowserAction(
      provider({
        operation: { type: "choice", choice: "CLICK", confidence: 0.95 },
        click_target: { type: "choice", choice: "e99", confidence: 0.99 },
      }),
      { goal: "g", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toBeUndefined();
  });

  it("declines when an operation arrives without a usable target", async () => {
    const planned = await planBrowserAction(
      provider({ operation: { type: "choice", choice: "CLICK", confidence: 0.95 } }),
      { goal: "g", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toBeUndefined();
  });

  it("never offers to type into a page with no editable field", async () => {
    const decide = vi.fn(async (_request: unknown) => ({ answers: {}, model: "m" }));
    await planBrowserAction(
      { decide },
      { goal: "g", snapshot: { elements: [{ ref: "e1", role: "button", name: "Go" }] } },
    );
    const request = decide.mock.calls[0]![0] as unknown as {
      questions: { operation: { criteria: Record<string, unknown> } };
    };
    expect(request.questions.operation.criteria).not.toHaveProperty("TYPE_TEXT");
    expect(request.questions.operation.criteria).toHaveProperty("BLOCKED");
  });

  it("returns nothing when the provider is unavailable", async () => {
    const planned = await planBrowserAction(
      { decide: vi.fn(async () => undefined) },
      { goal: "g", snapshot: { elements: ELEMENTS } },
    );
    expect(planned).toBeUndefined();
  });
});

describe("pursuing a goal over several steps", () => {
  function browser(snapshots: BrowserElement[][]) {
    const acted: unknown[] = [];
    let call = 0;
    return {
      acted,
      observe: vi.fn(async () => ({
        url: "https://x.test",
        snapshotId: `s${call}`,
        elements: snapshots[Math.min(call++, snapshots.length - 1)]!,
      })),
      act: vi.fn(async (request: unknown) => {
        acted.push(request);
        return {};
      }),
    };
  }

  it("clicks, re-observes, and stops when the model says the goal is met", async () => {
    let step = 0;
    const provider: DecisionProvider = {
      decide: vi.fn(async () => ({
        answers: (step++ === 0
          ? {
              operation: { type: "choice", choice: "CLICK", confidence: 0.9 },
              click_target: { type: "choice", choice: "e1", confidence: 0.9 },
            }
          : { operation: { type: "choice", choice: "DONE", confidence: 0.95 } }) as never,
        model: "m",
      })),
    };
    const io = browser([ELEMENTS, ELEMENTS]);
    const outcome = await pursueBrowserGoal(provider, { goal: "press search" }, io);
    expect(outcome.status).toBe("done");
    expect(outcome.steps).toEqual([{ operation: "CLICK", ref: "e1", name: "Search" }]);
    expect(io.acted).toEqual([{ action: "click", snapshotId: "s0", ref: "e1" }]);
    // Observed once at the start and again after the action, so refs are never reused.
    expect(io.observe).toHaveBeenCalledTimes(2);
  });

  it("types a value the agent supplied, keyed by the field name", async () => {
    let step = 0;
    const provider: DecisionProvider = {
      decide: vi.fn(async () => ({
        answers: (step++ === 0
          ? {
              operation: { type: "choice", choice: "TYPE_TEXT", confidence: 0.9 },
              type_text_target: { type: "choice", choice: "e2", confidence: 0.9 },
            }
          : { operation: { type: "choice", choice: "DONE", confidence: 0.95 } }) as never,
        model: "m",
      })),
    };
    const io = browser([ELEMENTS, ELEMENTS]);
    const outcome = await pursueBrowserGoal(
      provider,
      { goal: "set origin", values: { "Where from?": "Zurich" } },
      io,
    );
    expect(outcome.status).toBe("done");
    expect(io.acted).toEqual([{ action: "fill", snapshotId: "s0", ref: "e2", text: "Zurich" }]);
  });

  it("hands back rather than inventing a value nobody supplied", async () => {
    const provider: DecisionProvider = {
      decide: vi.fn(async () => ({
        answers: {
          operation: { type: "choice", choice: "TYPE_TEXT", confidence: 0.9 },
          type_text_target: { type: "choice", choice: "e2", confidence: 0.9 },
        } as never,
        model: "m",
      })),
    };
    const io = browser([ELEMENTS]);
    const outcome = await pursueBrowserGoal(provider, { goal: "set origin" }, io);
    expect(outcome.status).toBe("needs_value");
    expect(outcome.awaiting).toEqual({ ref: "e2", name: "Where from?" });
    expect(io.act).not.toHaveBeenCalled();
  });

  it("hands back when the model will not commit", async () => {
    const io = browser([ELEMENTS]);
    const outcome = await pursueBrowserGoal(
      { decide: vi.fn(async () => undefined) },
      { goal: "g" },
      io,
    );
    expect(outcome.status).toBe("undecided");
    expect(io.act).not.toHaveBeenCalled();
  });

  it("stops at the step limit instead of looping", async () => {
    const provider: DecisionProvider = {
      decide: vi.fn(async () => ({
        answers: {
          operation: { type: "choice", choice: "SCROLL_DOWN", confidence: 0.9 },
        } as never,
        model: "m",
      })),
    };
    const io = browser([ELEMENTS]);
    const outcome = await pursueBrowserGoal(provider, { goal: "g", maxSteps: 3 }, io);
    expect(outcome.status).toBe("step_limit");
    expect(outcome.steps).toHaveLength(3);
    expect(io.acted).toHaveLength(3);
  });

  it("never exceeds the hard step ceiling however many are asked for", async () => {
    const provider: DecisionProvider = {
      decide: vi.fn(async () => ({
        answers: { operation: { type: "choice", choice: "SCROLL_DOWN", confidence: 0.9 } } as never,
        model: "m",
      })),
    };
    const io = browser([ELEMENTS]);
    const outcome = await pursueBrowserGoal(provider, { goal: "g", maxSteps: 500 }, io);
    expect(outcome.steps).toHaveLength(MAX_PURSUIT_STEPS);
  });

  it("takes no step at all without a provider", async () => {
    const io = browser([ELEMENTS]);
    const outcome = await pursueBrowserGoal(undefined, { goal: "g" }, io);
    expect(outcome.status).toBe("undecided");
    expect(io.act).not.toHaveBeenCalled();
  });
});
