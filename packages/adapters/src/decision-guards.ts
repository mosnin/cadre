/**
 * Judgements that protect a run, answered by a decision model.
 *
 * Each of these replaces a guess with a read, or avoids work entirely. None of
 * them can weaken an existing guard: a decision may raise an approval bar, stop
 * a run, or skip an occurrence, and never the reverse. Without a provider, or
 * when the model will not commit, every one returns the caller's own answer.
 */

import { DECISION_CONFIDENCE, type NoulAnswer, noul } from "@rakazo/core";
import type { DecisionProvider } from "./jev-decisions.js";

function probability(answer: unknown): number | undefined {
  const noulAnswer = answer as NoulAnswer | undefined;
  if (noulAnswer?.type !== "noul") return undefined;
  return typeof noulAnswer.noul === "number" && Number.isFinite(noulAnswer.noul)
    ? noulAnswer.noul
    : undefined;
}

/** Enough of a trail to tell repetition from ordinary retrying. */
const MIN_EVIDENCE_CHARS = 200;

/**
 * Whether a run is repeating work that is not getting anywhere.
 *
 * The existing loop guard hashes the tool name and arguments and stops at five
 * identical calls. That catches an exact repeat and misses the expensive one: an
 * agent retrying the same broken thing with slightly different arguments, which
 * hashes differently every time and burns an unattended run's whole budget.
 *
 * `evidence` is whatever record of the run the caller has: its narration, or a
 * rendered list of recent actions. Too little of it and this declines to judge,
 * because a short trail looks the same whether the run is stuck or just started.
 */
export async function runIsStuck(
  provider: DecisionProvider | undefined,
  input: { goal: string; evidence: string; runId?: string; signal?: AbortSignal },
): Promise<boolean> {
  if (!provider || input.evidence.trim().length < MIN_EVIDENCE_CHARS) return false;
  const result = await provider.decide({
    state: {
      goal: input.goal.slice(0, 2_000),
      what_the_run_did: input.evidence.slice(-4_000),
    },
    questions: {
      stuck: noul(
        "Is this run repeating work that has already failed, without making progress toward the goal?",
        {
          true: "The same approach keeps being retried and the state is not changing.",
          false:
            "Each action moves the task on, or the repetition is how this task legitimately works.",
        },
      ),
    },
    sessionId: input.runId,
    signal: input.signal,
  });
  const value = probability(result?.answers.stuck);
  // Stopping a run that was in fact progressing is the worse error, so this
  // takes the highest bar of the three.
  return value !== undefined && value >= DECISION_CONFIDENCE.consequential;
}
