/**
 * Pick the next browser action with a decision model.
 *
 * The browser already produces an indexed table of the controls it can see. That table is an
 * action space: each control supports some operations and not others. Rather than asking a
 * chat model to write out an action and then parsing it, the operation and its target are
 * chosen directly from that space.
 *
 * Both are asked in one request. The target questions are speculative — a question is asked
 * for every operation that has candidates, and only the one matching the chosen operation is
 * used. Two decisions, one round trip, and a target that is always a control the browser just
 * reported rather than a selector a model invented.
 *
 * This only decides. Execution goes back through the ordinary browser path, so snapshot
 * freshness, the human-input epoch, occlusion checks and credential binding all still apply.
 */

import { actionableChoice, type ChoiceAnswer, choice, DECISION_CONFIDENCE } from "@rakazo/core";
import type { DecisionProvider } from "./jev-decisions.js";

/** Roles the browser will accept text into. */
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

export type BrowserElement = {
  ref: string;
  role: string;
  name: string;
  disabled?: unknown;
  checked?: unknown;
  required?: unknown;
};

export type BrowserSnapshot = {
  /** Refs are only valid against the snapshot that produced them; every action carries it. */
  snapshotId?: string;
  url?: string;
  title?: string;
  text?: string;
  elements?: BrowserElement[];
};

export type BrowserStep = { operation: string; ref?: string; name?: string; note?: string };

export type PlannedBrowserAction =
  | { operation: "CLICK" | "TYPE_TEXT"; ref: string; element: BrowserElement }
  | { operation: "PRESS_ENTER" | "SCROLL_DOWN" | "SCROLL_UP" | "DONE" | "BLOCKED" };

const CONTROL_OPERATIONS: Record<string, string> = {
  PRESS_ENTER: "Press Enter to submit the focused field or accept the highlighted suggestion.",
  SCROLL_DOWN: "Scroll down to bring more of the page into view.",
  SCROLL_UP: "Scroll up to bring earlier content back into view.",
  DONE: "Every part of the goal is visibly satisfied on this page.",
  BLOCKED: "No available operation can make progress toward the goal.",
};

const RULES = [
  "Choose the single next action that makes the most progress toward the goal.",
  "Only operations listed as options are available; only the listed targets exist.",
  "Prefer a control whose name matches what the goal asks for.",
  "Choose DONE only when the goal is already visibly satisfied, not when it merely looks close.",
  "Choose BLOCKED rather than repeating an action that has already failed to change the page.",
];

/** Build the operation-to-candidate map the questions are derived from. */
export function browserActionSpace(elements: BrowserElement[]): {
  targets: Record<string, BrowserElement[]>;
  table: { index: string; role: string; name: string; operations: string[] }[];
} {
  const targets: Record<string, BrowserElement[]> = {};
  const table: { index: string; role: string; name: string; operations: string[] }[] = [];
  for (const element of elements) {
    if (element.disabled === true) continue;
    const operations: string[] = [];
    // A text field is worth clicking as well as typing into: focusing it often opens the
    // suggestion list the next step needs.
    operations.push("CLICK");
    if (TEXT_ROLES.has(element.role)) operations.push("TYPE_TEXT");
    for (const operation of operations) {
      targets[operation] ??= [];
      targets[operation].push(element);
    }
    table.push({
      index: element.ref,
      role: element.role,
      name: element.name.slice(0, 200),
      operations,
    });
  }
  return { targets, table };
}

export async function planBrowserAction(
  provider: DecisionProvider | undefined,
  input: {
    goal: string;
    snapshot: BrowserSnapshot;
    history?: BrowserStep[];
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<PlannedBrowserAction | undefined> {
  if (!provider) return undefined;
  const elements = input.snapshot.elements ?? [];
  const { targets, table } = browserActionSpace(elements);

  const operations: Record<string, string> = {};
  if (targets.CLICK?.length) operations.CLICK = "Click a button, link, menu option, or suggestion.";
  if (targets.TYPE_TEXT?.length)
    operations.TYPE_TEXT = "Type a value into an editable field. The value is written separately.";
  Object.assign(operations, CONTROL_OPERATIONS);

  const questions: Record<string, ReturnType<typeof choice>> = {
    operation: choice({ goal: input.goal, rules: RULES }, operations),
  };
  // Speculative: a target question per operation that has candidates. Only the one matching
  // the chosen operation is read, so both decisions cost a single request.
  for (const [operation, candidates] of Object.entries(targets)) {
    if (candidates.length === 0) continue;
    questions[`${operation.toLowerCase()}_target`] = choice(
      { goal: input.goal, operation, rules: RULES },
      Object.fromEntries(
        candidates.map((element) => [
          element.ref,
          {
            element: `[${element.ref}] ${element.role} · ${element.name.slice(0, 200)}`,
            ...(element.checked === undefined ? {} : { checked: element.checked }),
            ...(element.required === undefined ? {} : { required: element.required }),
          },
        ]),
      ),
    );
  }

  const result = await provider.decide({
    state: {
      page: {
        url: input.snapshot.url,
        title: input.snapshot.title,
        text: (input.snapshot.text ?? "").slice(0, 6_000),
      },
      elements: table,
      recent_actions: (input.history ?? []).slice(-10),
    },
    questions,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return undefined;

  const operation = actionableChoice(
    result.answers.operation,
    Object.keys(operations),
    DECISION_CONFIDENCE.routing,
  );
  if (!operation) return undefined;
  if (operation !== "CLICK" && operation !== "TYPE_TEXT") {
    return {
      operation: operation as "PRESS_ENTER" | "SCROLL_DOWN" | "SCROLL_UP" | "DONE" | "BLOCKED",
    };
  }

  const candidates = targets[operation] ?? [];
  const ref = actionableChoice(
    result.answers[`${operation.toLowerCase()}_target`] as ChoiceAnswer | undefined,
    candidates.map((element) => element.ref),
    DECISION_CONFIDENCE.routing,
  );
  // An operation without a target it can actually execute is no decision at all.
  if (!ref) return undefined;
  const element = candidates.find((candidate) => candidate.ref === ref)!;
  return { operation, ref, element };
}

/** How many actions one pursue call may take before handing control back to the agent. */
export const MAX_PURSUIT_STEPS = 8;

export type PursuitOutcome = {
  status: "done" | "blocked" | "needs_value" | "undecided" | "step_limit";
  steps: BrowserStep[];
  /** The control waiting for a value, when the model chose to type and none was supplied. */
  awaiting?: { ref: string; name: string };
  snapshot?: BrowserSnapshot;
};

/**
 * Take several browser steps toward a goal in one tool call.
 *
 * Each step costs one decision request and one browser call rather than a full turn of the
 * run's own model, which is where the time goes in a multi-step form. The loop stops as soon
 * as it is not sure: an undecided step, a field whose value nobody supplied, or the step limit
 * all hand control back with the trace so far rather than guessing.
 *
 * `observe` and `act` are supplied by the caller, so every action still goes through the
 * ordinary browser path and its freshness, occlusion and credential guards.
 */
export async function pursueBrowserGoal(
  provider: DecisionProvider | undefined,
  input: {
    goal: string;
    /** Text the agent already knows, keyed by the field's accessible name. */
    values?: Record<string, string>;
    maxSteps?: number;
    sessionId?: string;
    signal?: AbortSignal;
  },
  browser: {
    observe: () => Promise<BrowserSnapshot>;
    act: (request: {
      action: "click" | "fill" | "press" | "scroll";
      snapshotId?: string;
      ref?: string;
      text?: string;
      key?: string;
      direction?: string;
    }) => Promise<unknown>;
  },
): Promise<PursuitOutcome> {
  const steps: BrowserStep[] = [];
  const limit = Math.max(1, Math.min(input.maxSteps ?? MAX_PURSUIT_STEPS, MAX_PURSUIT_STEPS));
  let snapshot = await browser.observe();

  for (let step = 0; step < limit; step += 1) {
    const planned = await planBrowserAction(provider, {
      goal: input.goal,
      snapshot,
      history: steps,
      sessionId: input.sessionId,
      signal: input.signal,
    });
    if (!planned) return { status: "undecided", steps, snapshot };
    if (planned.operation === "DONE") return { status: "done", steps, snapshot };
    if (planned.operation === "BLOCKED") return { status: "blocked", steps, snapshot };

    if (planned.operation === "TYPE_TEXT") {
      const value = input.values?.[planned.element.name];
      // The decision model chooses where to type; it never invents what to type.
      if (value === undefined) {
        return {
          status: "needs_value",
          steps,
          snapshot,
          awaiting: { ref: planned.ref, name: planned.element.name },
        };
      }
      await browser.act({
        action: "fill",
        snapshotId: snapshot.snapshotId,
        ref: planned.ref,
        text: value,
      });
      steps.push({ operation: "TYPE_TEXT", ref: planned.ref, name: planned.element.name });
    } else if (planned.operation === "CLICK") {
      await browser.act({ action: "click", snapshotId: snapshot.snapshotId, ref: planned.ref });
      steps.push({ operation: "CLICK", ref: planned.ref, name: planned.element.name });
    } else if (planned.operation === "PRESS_ENTER") {
      await browser.act({ action: "press", snapshotId: snapshot.snapshotId, key: "Enter" });
      steps.push({ operation: "PRESS_ENTER" });
    } else {
      const direction = planned.operation === "SCROLL_UP" ? "up" : "down";
      await browser.act({ action: "scroll", direction });
      steps.push({ operation: planned.operation });
    }
    // Every action invalidates the refs it was chosen from, so the next decision is made
    // against a fresh table rather than a remembered one.
    snapshot = await browser.observe();
  }
  return { status: "step_limit", steps, snapshot };
}
