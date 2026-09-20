/**
 * Closed next-action after a start prefetch or a tool result.
 *
 * A chat model picking the next tool is a generation: seconds, plus thinking
 * and the whole catalog. The next step is usually already in a closed set —
 * write the answer, pursue the page already on screen, fetch a URL that is
 * already in the task or the last result. Jev picks from that set. A hedge
 * leaves the field unset so the chat model decides, as today.
 *
 * The first rule still holds: this request replaces a generation. It never
 * invents a URL, a search query, or a pursue goal — those come from the task
 * or the last result.
 */

import { actionableChoice, choice, DECISION_ABSTAIN, DECISION_CONFIDENCE } from "@cadre/core";
import type { PursuitOutcome } from "./decision-browser.js";
import { extractTaskUrls, searchQueryForStart } from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";
import type { PrefetchedStart } from "./web-tools.js";

const MAX_TASK_CHARS = 4_000;
const MAX_RESULT_CHARS = 2_000;
const MAX_URLS = 5;

export const NEXT_ACTIONS = {
  answer: "The task is already answered. Write the reply. No tool is needed.",
  pursue: "Act on the live page toward the user's existing goal.",
  fetch: "Read a URL that is already in the task or the last result.",
  search: "Search using the user's own wording as the query.",
} as const;

export type NextHarnessAction =
  | { kind: "write" }
  | { kind: "pursue" }
  | { kind: "fetch"; url: string }
  | { kind: "search"; query: string };

/** First generation only writes: the page, hits, or start already finished the work. */
export function shouldWriteFirstTurn(input: {
  start: { first?: string };
  prefetch?: PrefetchedStart;
  pursued?: Pick<PursuitOutcome, "status">;
  hasFileAttachments?: boolean;
}): boolean {
  if (input.hasFileAttachments) return false;
  if (input.start.first === "answer") return true;
  if (input.prefetch?.kind === "search" && input.prefetch.answered) return true;
  return input.pursued?.status === "done";
}

/**
 * A lone observe on an answer/search/fetch start is a look, not a click loop.
 * Anything else that opened the page already has a goal the harness can pursue.
 */
export function shouldPursueAfterObserve(start: { first?: string }): boolean {
  return start.first !== "answer" && start.first !== "search" && start.first !== "fetch";
}

/** Chromium / Chrome / Firefox titles — Jev cannot click from a screenshot. */
export function isBrowserFocusedWindow(title?: string): boolean {
  if (!title) return false;
  return /\b(chrom(e|ium)|google chrome|firefox|brave|msedge|microsoft edge|safari)\b/i.test(title);
}

export function computerActUsesCoordinates(args: Record<string, unknown>): boolean {
  const actions = Array.isArray(args.actions) ? args.actions : [];
  return actions.some((action) => {
    if (!action || typeof action !== "object") return false;
    const kind = String((action as { kind?: unknown }).kind ?? "");
    return kind === "click" || kind === "move" || kind === "down" || kind === "up";
  });
}

/** http(s) URLs already in a search/fetch result, so a follow-up fetch can point. */
export function extractResultUrls(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const urls: string[] = [];
  const record = result as Record<string, unknown>;
  if (typeof record.url === "string") urls.push(record.url);
  const hits = Array.isArray(record.results) ? record.results : [];
  for (const hit of hits) {
    if (hit && typeof hit === "object" && typeof (hit as { url?: unknown }).url === "string") {
      urls.push((hit as { url: string }).url);
    }
  }
  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))].slice(0, MAX_URLS);
}

export async function decideNextAction(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    lastTool: string;
    lastResult: string;
    urls?: string[];
    canPursue?: boolean;
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<NextHarnessAction | undefined> {
  if (!provider) return undefined;
  const task = input.task.trim();
  if (!task) return undefined;

  const searchQuery = input.lastTool === "web_search" ? undefined : searchQueryForStart(task);
  const urls = (input.urls ?? []).filter((url) => url.trim()).slice(0, MAX_URLS);
  const options: Record<string, string> = {
    answer: NEXT_ACTIONS.answer,
    [DECISION_ABSTAIN]: "The next step is not one of these.",
  };
  if (input.canPursue) options.pursue = NEXT_ACTIONS.pursue;
  if (urls.length > 0) options.fetch = NEXT_ACTIONS.fetch;
  if (searchQuery) options.search = NEXT_ACTIONS.search;

  const questions: Record<string, ReturnType<typeof choice>> = {
    next: choice(
      {
        task: "What should this run do next?",
        rules: [
          "Pick the cheapest next step that serves the request.",
          "Use answer when the last result already has what is needed.",
          "Use fetch only for a URL that is already listed.",
          "Use pursue only to act on the page that is already on screen.",
          "Use search only when the user's own wording is already the query.",
          "Prefer none_of_these over a stretch.",
        ],
      },
      options,
    ),
  };
  if (urls.length > 0) {
    questions.fetch_url = choice(
      {
        task: "If a listed URL should be read next, which one?",
        rules: ["Pick a URL only when the last result is not enough.", "Prefer none_of_these."],
      },
      {
        ...Object.fromEntries(urls.map((url) => [url, url])),
        [DECISION_ABSTAIN]: "None of these URLs should be fetched next.",
      },
    );
  }

  const result = await provider.decide({
    state: {
      task: task.slice(0, MAX_TASK_CHARS),
      last_tool: input.lastTool,
      last_result: input.lastResult.slice(0, MAX_RESULT_CHARS),
      ...(urls.length > 0 ? { urls } : {}),
    },
    questions,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return undefined;

  const next = actionableChoice(
    result.answers.next,
    Object.keys(options).filter((key) => key !== DECISION_ABSTAIN),
    DECISION_CONFIDENCE.routing,
  );
  if (next === "answer") return { kind: "write" };
  if (next === "pursue" && input.canPursue) return { kind: "pursue" };
  if (next === "search" && searchQuery) return { kind: "search", query: searchQuery };
  if (next === "fetch" && urls.length > 0) {
    const url =
      actionableChoice(result.answers.fetch_url, urls, DECISION_CONFIDENCE.routing) ??
      (urls.length === 1 ? urls[0] : undefined);
    if (url) return { kind: "fetch", url };
  }
  return undefined;
}

/** URLs already written in the task, plus any the last result pointed at. */
export function closedFollowUpUrls(task: string, result: unknown): string[] {
  return [...new Set([...extractTaskUrls(task), ...extractResultUrls(result)])].slice(0, MAX_URLS);
}
