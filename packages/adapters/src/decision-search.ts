/**
 * Rank web search results with a decision model.
 *
 * A search engine orders results by its own relevance to a string. The agent asked a question.
 * Scoring each result against the actual question, and putting the ones that answer it first,
 * means the pages the agent reads are the pages worth reading — and the ones that do not
 * answer it never reach the model's context at all.
 *
 * Every result becomes one score question, and all of them travel in a single request. Without
 * a decision provider, or when the model hedges, the engine's own order is returned unchanged.
 */

import type { WebSearchHit } from "@cadre/adapter-kit";
import {
  answerConfidence,
  DECISION_CONFIDENCE,
  type NoulAnswer,
  noul,
  type ScoreAnswer,
  score,
} from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

/** Ordered lowest to highest; the answer is the index of the level that fits. */
const RELEVANCE_LEVELS = [
  "Unrelated to the question.",
  "Same topic, but does not address the question.",
  "Touches the question without answering it.",
  "Answers part of the question.",
  "Directly answers the question.",
];

/** One request stays bounded: the tail of a result list is rarely what gets read anyway. */
const MAX_RANKED = 12;
const SNIPPET_CHARS = 400;
/** Below this, a result is noise the agent should not spend a fetch on. */
const DROP_BELOW = 1;

export type RankedWebSearchHit = WebSearchHit & { relevance?: number };

export type RankedWebSearch = {
  hits: RankedWebSearchHit[];
  /** True when the shortlist already answers the question; the agent should not fetch more. */
  answered: boolean;
};

function noulValue(answer: unknown): number | undefined {
  const value = answer as NoulAnswer | undefined;
  if (value?.type !== "noul") return undefined;
  return typeof value.noul === "number" && Number.isFinite(value.noul) ? value.noul : undefined;
}

function scoreOf(answer: ScoreAnswer | undefined): number | undefined {
  if (!answer || typeof answer.score !== "number" || !Number.isFinite(answer.score))
    return undefined;
  if (answerConfidence(answer) < DECISION_CONFIDENCE.advisory) return undefined;
  return Math.max(0, Math.min(RELEVANCE_LEVELS.length - 1, answer.score));
}

export async function rankWebSearchHits(
  provider: DecisionProvider | undefined,
  query: string,
  hits: WebSearchHit[],
  options: { sessionId?: string; signal?: AbortSignal } = {},
): Promise<RankedWebSearch> {
  if (!provider || hits.length < 2) return { hits, answered: false };
  const ranked = hits.slice(0, MAX_RANKED);
  const questions: Record<string, ReturnType<typeof score> | ReturnType<typeof noul>> =
    Object.fromEntries(
      ranked.map((_hit, index) => [
        `r${index}`,
        score(
          { question: query, task: "How well does this result answer the question?" },
          RELEVANCE_LEVELS,
        ),
      ]),
    );
  questions.answered = noul(
    "Do these results already answer the question well enough that fetching more pages is unnecessary?",
    {
      true: "The snippets contain the answer. Opening another page would not change it.",
      false: "The answer is not here, or a specific page still needs to be read.",
    },
  );
  const result = await provider.decide({
    // The results are the state; each question points at one of them by index.
    state: {
      question: query,
      results: ranked.map((hit, index) => ({
        id: `r${index}`,
        title: hit.title.slice(0, 200),
        url: hit.url,
        snippet: hit.snippet.slice(0, SNIPPET_CHARS),
      })),
    },
    questions,
    sessionId: options.sessionId,
    signal: options.signal,
  });
  if (!result) return { hits, answered: false };

  const enough = noulValue(result.answers.answered);
  const answered = enough !== undefined && enough >= DECISION_CONFIDENCE.routing;

  const scored = ranked.map((hit, index) => ({
    hit,
    index,
    relevance: scoreOf(result.answers[`r${index}`] as ScoreAnswer | undefined),
  }));
  // A model that scored nothing usably leaves the engine's own order.
  if (scored.every((entry) => entry.relevance === undefined)) return { hits, answered };

  const kept = scored.filter(
    (entry) => entry.relevance === undefined || entry.relevance > DROP_BELOW,
  );
  // Never return an empty list because the model disliked everything; the agent can still judge.
  const surviving = kept.length > 0 ? kept : scored;
  surviving.sort((left, right) => {
    const delta = (right.relevance ?? -1) - (left.relevance ?? -1);
    // An unscored result keeps its engine position rather than being pushed to the bottom.
    return delta !== 0 ? delta : left.index - right.index;
  });
  return {
    hits: [
      ...surviving.map(({ hit, relevance }) =>
        relevance === undefined ? hit : { ...hit, relevance },
      ),
      ...hits.slice(MAX_RANKED),
    ],
    answered,
  };
}
