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

/** The option that means "no supplied value belongs here", so the model need not force one. */
const NO_ENTITY = "none_of_these";

/** Roles the browser will accept text into. */
const TEXT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

export type BrowserElement = {
  ref: string;
  role: string;
  name: string;
  disabled?: unknown;
  checked?: unknown;
  required?: unknown;
  selected?: unknown;
  expanded?: unknown;
  /** The choices of a native dropdown, as the browser reported them. */
  options?: string[];
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

/** A value the agent already holds, offered as something to point at rather than to write. */
export type BrowserEntity = { label: string; value: string };

export type ControlOperation =
  | "PRESS_ENTER"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export type PlannedBrowserAction =
  | {
      operation: "CLICK" | "TYPE_TEXT";
      ref: string;
      element: BrowserElement;
      /** For TYPE_TEXT: the entity the decision picked for this field, if any. */
      entity?: BrowserEntity;
    }
  | { operation: "SELECT"; ref: string; element: BrowserElement; option: string }
  | { operation: ControlOperation };

const CONTROL_OPERATIONS: Record<string, string> = {
  PRESS_ENTER: "Press Enter to submit the focused field or accept the highlighted suggestion.",
  SCROLL_DOWN: "Scroll down to bring more of the page into view.",
  SCROLL_UP: "Scroll up to bring earlier content back into view.",
  WAIT: "The page is still loading or working; nothing can be acted on until it settles.",
  DONE: "Every part of the goal is visibly satisfied on this page.",
  BLOCKED: "No available operation can make progress toward the goal.",
};

/** Dropdown choices offered in one question, across every dropdown on the page. */
const MAX_SELECT_CHOICES = 60;
/** Separates the control from the option inside one dropdown choice. */
const SELECT_SEPARATOR = "::";

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
  table: {
    index: string;
    role: string;
    name: string;
    operations: string[];
    options?: string[];
  }[];
} {
  const targets: Record<string, BrowserElement[]> = {};
  const table: {
    index: string;
    role: string;
    name: string;
    operations: string[];
    options?: string[];
  }[] = [];
  for (const element of elements) {
    if (element.disabled === true) continue;
    const operations: string[] = [];
    // A text field is worth clicking as well as typing into: focusing it often opens the
    // suggestion list the next step needs.
    operations.push("CLICK");
    if (TEXT_ROLES.has(element.role)) operations.push("TYPE_TEXT");
    // A native dropdown has no on-screen list to click, so choosing from it is its own
    // operation; the choices come from the browser, never from the model.
    if (element.options?.length) operations.push("SELECT");
    for (const operation of operations) {
      targets[operation] ??= [];
      targets[operation].push(element);
    }
    table.push({
      index: element.ref,
      role: element.role,
      name: element.name.slice(0, 200),
      operations,
      ...(element.options?.length ? { options: element.options.slice(0, 50) } : {}),
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
    /** Known values the agent holds. Filling picks one of these; it never writes a value. */
    entities?: BrowserEntity[];
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
  // One flat list of every dropdown choice on the page, so picking the control and
  // picking its option are the same decision rather than two round trips.
  const selectChoices: { key: string; element: BrowserElement; option: string }[] = [];
  for (const element of targets.SELECT ?? []) {
    for (const option of element.options ?? []) {
      if (selectChoices.length >= MAX_SELECT_CHOICES) break;
      selectChoices.push({ key: `${element.ref}${SELECT_SEPARATOR}${option}`, element, option });
    }
  }
  if (selectChoices.length > 0)
    operations.SELECT = "Choose one of the listed options of a dropdown.";
  Object.assign(operations, CONTROL_OPERATIONS);

  const questions: Record<string, ReturnType<typeof choice>> = {
    operation: choice({ goal: input.goal, rules: RULES }, operations),
  };
  // Speculative: a target question per operation that has candidates. Only the one matching
  // the chosen operation is read, so both decisions cost a single request.
  for (const [operation, candidates] of Object.entries(targets)) {
    // SELECT asks for a control and an option together, below.
    if (candidates.length === 0 || operation === "SELECT") continue;
    questions[`${operation.toLowerCase()}_target`] = choice(
      { goal: input.goal, operation, rules: RULES },
      Object.fromEntries(
        candidates.map((element) => [
          element.ref,
          {
            element: `[${element.ref}] ${element.role} · ${element.name.slice(0, 200)}`,
            ...(element.checked === undefined ? {} : { checked: element.checked }),
            ...(element.required === undefined ? {} : { required: element.required }),
            ...(element.selected === undefined ? {} : { selected: element.selected }),
            ...(element.expanded === undefined ? {} : { expanded: element.expanded }),
          },
        ]),
      ),
    );
  }

  if (selectChoices.length > 0) {
    questions.select_choice = choice(
      { goal: input.goal, operation: "SELECT", rules: RULES },
      Object.fromEntries(
        selectChoices.map((candidate) => [
          candidate.key,
          `[${candidate.element.ref}] ${candidate.element.name.slice(0, 120)} · ${candidate.option}`,
        ]),
      ),
    );
  }

  // Filling a field is a mapping problem, not a writing one: the agent already holds
  // the values, and which known value belongs in which field is a choice over a
  // closed set. Asking it here means a form is filled without generating a single
  // character, and the value can only ever be one the caller supplied.
  const entities = (input.entities ?? []).slice(0, 40);
  if (entities.length > 0 && targets.TYPE_TEXT?.length) {
    questions.type_text_value = choice(
      { goal: input.goal, task: "Which known value belongs in the field being filled?" },
      {
        ...Object.fromEntries(
          entities.map((entity, index) => [
            `v${index}`,
            `${entity.label}: ${entity.value.slice(0, 200)}`,
          ]),
        ),
        [NO_ENTITY]: "None of these belongs in that field.",
      },
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
  if (operation === "SELECT") {
    const picked = actionableChoice(
      result.answers.select_choice,
      selectChoices.map((candidate) => candidate.key),
      DECISION_CONFIDENCE.routing,
    );
    const candidate = selectChoices.find((entry) => entry.key === picked);
    // An operation without a target it can actually execute is no decision at all.
    if (!candidate) return undefined;
    return {
      operation: "SELECT",
      ref: candidate.element.ref,
      element: candidate.element,
      option: candidate.option,
    };
  }
  if (operation !== "CLICK" && operation !== "TYPE_TEXT") {
    return { operation: operation as ControlOperation };
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
  if (operation !== "TYPE_TEXT" || entities.length === 0) return { operation, ref, element };
  const picked = actionableChoice(
    result.answers.type_text_value,
    [...entities.map((_, index) => `v${index}`), NO_ENTITY],
    DECISION_CONFIDENCE.routing,
  );
  // NO_ENTITY, a hedge, or silence all leave the value unresolved, and the caller
  // hands back rather than typing something nobody supplied.
  const index = picked && picked !== NO_ENTITY ? Number(picked.slice(1)) : -1;
  return { operation, ref, element, entity: entities[index] };
}

/** How many actions one pursue call may take before handing control back to the agent. */
export const MAX_PURSUIT_STEPS = 8;
/** How long a wait step gives the page, and how many waits a pursuit may spend. */
const WAIT_MS = 500;
const MAX_WAITS = 2;

export type PursuitOutcome = {
  status: "done" | "blocked" | "needs_value" | "undecided" | "step_limit" | "failed";
  steps: BrowserStep[];
  /** The control waiting for a value, when the model chose to type and none was supplied. */
  awaiting?: { ref: string; name: string };
  /** Why the browser refused the step, when it did. */
  error?: string;
  snapshot?: BrowserSnapshot;
};

/**
 * Every action already answers with the page it produced, so a separate observation
 * would re-walk the accessibility tree for a snapshot the browser just handed back.
 */
function observedSnapshot(result: unknown): BrowserSnapshot | undefined {
  const page = result as BrowserSnapshot | undefined;
  return typeof page?.snapshotId === "string" ? page : undefined;
}

function refusal(result: unknown): string | undefined {
  const message = (result as { error?: unknown } | undefined)?.error;
  return typeof message === "string" && message ? message : undefined;
}

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
    /**
     * The same knowledge without having to guess field names in advance. The decision
     * picks which of these belongs in whichever field it chose to fill.
     */
    entities?: BrowserEntity[];
    maxSteps?: number;
    sessionId?: string;
    signal?: AbortSignal;
  },
  browser: {
    observe: () => Promise<BrowserSnapshot>;
    act: (request: {
      action: "click" | "fill" | "press" | "scroll" | "select";
      snapshotId?: string;
      ref?: string;
      text?: string;
      key?: string;
      direction?: string;
      option?: string;
    }) => Promise<unknown>;
  },
): Promise<PursuitOutcome> {
  const steps: BrowserStep[] = [];
  let waits = 0;
  const limit = Math.max(1, Math.min(input.maxSteps ?? MAX_PURSUIT_STEPS, MAX_PURSUIT_STEPS));
  let snapshot = await browser.observe();

  for (let step = 0; step < limit; step += 1) {
    const planned = await planBrowserAction(provider, {
      goal: input.goal,
      snapshot,
      history: steps,
      entities: input.entities,
      sessionId: input.sessionId,
      signal: input.signal,
    });
    let acted: unknown;
    if (!planned) return { status: "undecided", steps, snapshot };
    if (planned.operation === "DONE") return { status: "done", steps, snapshot };
    if (planned.operation === "BLOCKED") return { status: "blocked", steps, snapshot };

    if (planned.operation === "TYPE_TEXT") {
      // A value the decision pointed at wins: it was chosen against the field that was
      // actually picked, where the name map was written before the page was seen.
      const value = planned.entity?.value ?? input.values?.[planned.element.name];
      // The decision model chooses where to type; it never invents what to type.
      if (value === undefined) {
        return {
          status: "needs_value",
          steps,
          snapshot,
          awaiting: { ref: planned.ref, name: planned.element.name },
        };
      }
      acted = await browser.act({
        action: "fill",
        snapshotId: snapshot.snapshotId,
        ref: planned.ref,
        text: value,
      });
      steps.push({
        operation: "TYPE_TEXT",
        ref: planned.ref,
        name: planned.element.name,
        note: planned.entity?.label,
      });
    } else if (planned.operation === "SELECT") {
      acted = await browser.act({
        action: "select",
        snapshotId: snapshot.snapshotId,
        ref: planned.ref,
        option: planned.option,
      });
      steps.push({
        operation: "SELECT",
        ref: planned.ref,
        name: planned.element.name,
        note: planned.option,
      });
    } else if (planned.operation === "WAIT") {
      // Waiting changes nothing, so a run that only ever waits is a run that is stuck.
      waits += 1;
      if (waits > MAX_WAITS) return { status: "blocked", steps, snapshot };
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      steps.push({ operation: "WAIT" });
    } else if (planned.operation === "CLICK") {
      acted = await browser.act({
        action: "click",
        snapshotId: snapshot.snapshotId,
        ref: planned.ref,
      });
      steps.push({ operation: "CLICK", ref: planned.ref, name: planned.element.name });
    } else if (planned.operation === "PRESS_ENTER") {
      acted = await browser.act({ action: "press", snapshotId: snapshot.snapshotId, key: "Enter" });
      steps.push({ operation: "PRESS_ENTER" });
    } else {
      const direction = planned.operation === "SCROLL_UP" ? "up" : "down";
      acted = await browser.act({ action: "scroll", direction });
      steps.push({ operation: planned.operation });
    }
    // A refusal means the page moved under the plan. Hand back with the trace rather than
    // re-deciding against a page nobody has looked at since.
    const refused = refusal(acted);
    if (refused) return { status: "failed", steps, snapshot, error: refused };
    // Every action invalidates the refs it was chosen from, so the next decision is made
    // against a fresh table rather than a remembered one — which the action itself already
    // returned, so only a step that dispatched nothing has to go and look.
    snapshot = observedSnapshot(acted) ?? (await browser.observe());
  }
  return { status: "step_limit", steps, snapshot };
}
