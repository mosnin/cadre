/**
 * Rank a connector-catalog shortlist against the query the agent actually typed.
 *
 * Keyword scoring already cut the list. This only reorders what remains so the first
 * ids the agent loads are the ones that do the job, and a hedged answer keeps the
 * keyword order.
 */

import { answerConfidence, DECISION_CONFIDENCE, type ScoreAnswer, score } from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

export type RankableCatalogHit = {
  id: string;
  name: string;
  description: string;
  readOnly: boolean;
};

const FIT_LEVELS = [
  "Unrelated to the query.",
  "Same source or topic, but the wrong operation.",
  "Might be usable if nothing closer exists.",
  "Matches the query and should be loaded first.",
];

const MAX_RANKED = 10;
const DESCRIPTION_CHARS = 240;

function relevance(answer: ScoreAnswer | undefined): number | undefined {
  if (!answer || typeof answer.score !== "number" || !Number.isFinite(answer.score)) {
    return undefined;
  }
  if (answerConfidence(answer) < DECISION_CONFIDENCE.advisory) return undefined;
  return Math.max(0, Math.min(FIT_LEVELS.length - 1, answer.score));
}

export async function rankCatalogHits<T extends RankableCatalogHit>(
  provider: DecisionProvider | undefined,
  query: string,
  hits: T[],
  options: { sessionId?: string; signal?: AbortSignal } = {},
): Promise<T[]> {
  const trimmed = query.trim();
  if (!provider || !trimmed || hits.length < 2) return hits;
  const ranked = hits.slice(0, MAX_RANKED);
  const remainder = hits.slice(MAX_RANKED);

  const result = await provider.decide({
    state: {
      query: trimmed.slice(0, 200),
      tools: ranked.map((hit, index) => ({
        id: `t${index}`,
        name: hit.name,
        description: hit.description.slice(0, DESCRIPTION_CHARS),
      })),
    },
    questions: Object.fromEntries(
      ranked.map((_hit, index) => [
        `t${index}`,
        score({ query: trimmed, task: "How well does this tool match the search?" }, FIT_LEVELS),
      ]),
    ),
    sessionId: options.sessionId,
    signal: options.signal,
  });
  if (!result) return hits;

  const scored = ranked.map((hit, index) => ({
    hit,
    index,
    relevance: relevance(result.answers[`t${index}`] as ScoreAnswer | undefined),
  }));
  if (scored.every((entry) => entry.relevance === undefined)) return hits;

  scored.sort((left, right) => {
    const delta = (right.relevance ?? -1) - (left.relevance ?? -1);
    return delta !== 0 ? delta : left.index - right.index;
  });
  return [...scored.map((entry) => entry.hit), ...remainder];
}
