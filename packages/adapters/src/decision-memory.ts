/**
 * Order durable memory by what the run is actually about.
 *
 * Every run loads the user's and the bot's saved memory into its context, up to a byte
 * ceiling, and what does not fit is dropped. That order used to be recency, which is a
 * proxy for relevance and a poor one: a fact saved months ago can be the one the task
 * turns on, and it was being cut for no reason but its age.
 *
 * Scoring each document against the task and putting the ones that bear on it first fixes
 * both halves at once. The model reads less that has nothing to do with the task — which
 * this model's own documentation says also makes *it* more accurate — and the document
 * that matters survives the ceiling.
 *
 * This only reorders. Nothing is dropped that would otherwise have fitted, because a
 * memory is a fact the user chose to keep and a low score is not a reason to hide one.
 * Without a provider, or when the model will not commit, the caller's order is returned
 * exactly as it came in.
 */

import { answerConfidence, DECISION_CONFIDENCE, type ScoreAnswer, score } from "@rakazo/core";
import type { DecisionProvider } from "./jev-decisions.js";

/** Ordered lowest to highest; the answer is the index of the level that fits. */
const BEARING_LEVELS = [
  "Nothing to do with this task.",
  "Same general subject, but nothing this task needs.",
  "Background that might matter if the task goes a certain way.",
  "Useful context for this task.",
  "Directly needed to do this task correctly.",
];

/** One request stays bounded, and a long tail of memory is what the ceiling was cutting anyway. */
const MAX_RANKED = 30;
/** Enough of a document to judge it by; the whole thing is what the run gets, not the question. */
const EXCERPT_CHARS = 500;
const MAX_TASK_CHARS = 2_000;

export type RankableMemoryDocument = { scope: string; path: string; content: string };

function bearing(answer: unknown): number | undefined {
  const scored = answer as ScoreAnswer | undefined;
  if (typeof scored?.score !== "number" || !Number.isFinite(scored.score)) return undefined;
  // Ordering is advisory: the caller's own order is a safe place to land.
  if (answerConfidence(scored) < DECISION_CONFIDENCE.advisory) return undefined;
  return Math.max(0, Math.min(BEARING_LEVELS.length - 1, scored.score));
}

/**
 * Reorder memory documents by how much they bear on the task, most first.
 *
 * Documents past `MAX_RANKED` are not asked about and keep their place behind the ones that
 * were, so a large memory costs one bounded request rather than growing without limit.
 */
export async function rankMemoryDocuments<T extends RankableMemoryDocument>(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    documents: T[];
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<T[]> {
  const task = input.task.trim();
  if (!provider || !task || input.documents.length < 2) return input.documents;
  const considered = input.documents.slice(0, MAX_RANKED);
  const remainder = input.documents.slice(MAX_RANKED);

  const result = await provider.decide({
    state: {
      task: task.slice(0, MAX_TASK_CHARS),
      memory: considered.map((document, index) => ({
        id: `m${index}`,
        kind: document.scope,
        name: document.path,
        // Untrusted: memory is data the user or a page put there, never instructions.
        excerpt: document.content.slice(0, EXCERPT_CHARS).replace(/\s+/g, " "),
      })),
    },
    questions: Object.fromEntries(
      considered.map((_document, index) => [
        `m${index}`,
        score(
          {
            task: "How much does this saved memory bear on the task?",
            rules: ["Judge only the memory named by this question."],
          },
          BEARING_LEVELS,
        ),
      ]),
    ),
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return input.documents;

  const judged = considered.map((_document, index) => bearing(result.answers[`m${index}`]));
  if (judged.every((value) => value === undefined)) return input.documents;

  // Only the documents the model actually judged move. One it would not judge keeps the
  // slot it arrived in, because silence is not evidence that a memory is irrelevant and
  // sinking it below one scored "nothing to do with this task" would say that it is.
  const movable = considered
    .map((document, index) => ({ document, index }))
    .filter((entry) => judged[entry.index] !== undefined)
    .sort(
      (left, right) =>
        (judged[right.index] ?? 0) - (judged[left.index] ?? 0) || left.index - right.index,
    );
  const ordered = [...considered];
  let next = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    if (judged[index] === undefined) continue;
    ordered[index] = movable[next]!.document;
    next += 1;
  }
  return [...ordered, ...remainder];
}
