/**
 * Judgements that protect a run, answered by a decision model.
 *
 * Each of these replaces a guess with a read, or avoids work entirely. None of
 * them can weaken an existing guard: a decision may raise an approval bar, stop
 * a run, or skip an occurrence, and never the reverse. Without a provider, or
 * when the model will not commit, every one returns the caller's own answer.
 *
 * The floor assessment is the Foreman pattern: several independent nouls about
 * the same trail, in one request, with policy in code. A yes may stop the run.
 * Nothing here may declare the work finished.
 */

import { DECISION_CONFIDENCE, type NoulAnswer, noul } from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

function probability(answer: unknown): number | undefined {
  const noulAnswer = answer as NoulAnswer | undefined;
  if (noulAnswer?.type !== "noul") return undefined;
  return typeof noulAnswer.noul === "number" && Number.isFinite(noulAnswer.noul)
    ? noulAnswer.noul
    : undefined;
}

function licensed(answer: unknown): boolean {
  const value = probability(answer);
  return value !== undefined && value >= DECISION_CONFIDENCE.consequential;
}

/** Enough of a trail to tell repetition from ordinary retrying. */
const MIN_EVIDENCE_CHARS = 200;

export type RunFloorReason = "loop" | "off_track" | "needs_human";

export type RunFloorAssessment = {
  stop: boolean;
  reason?: RunFloorReason;
};

/**
 * Whether a run should be stopped before another segment is spent.
 *
 * The existing loop guard hashes the tool name and arguments and stops at five
 * identical calls. That catches an exact repeat and misses the expensive ones:
 * retrying the same broken thing with slightly different arguments, drifting
 * off the task, or needing a person. Those three questions travel together.
 */
export async function assessRunFloor(
  provider: DecisionProvider | undefined,
  input: { goal: string; evidence: string; runId?: string; signal?: AbortSignal },
): Promise<RunFloorAssessment> {
  if (!provider || input.evidence.trim().length < MIN_EVIDENCE_CHARS) return { stop: false };
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
      off_track: noul("Has this run drifted onto work that does not serve the original goal?", {
        true: "The recent actions are unrelated to the goal or are solving a different problem.",
        false: "The recent actions still serve the goal, even if they are struggling.",
      }),
      needs_human: noul("Does this run need a person before it can usefully continue?", {
        true: "It is blocked on judgment, credentials, clarification, or permission.",
        false: "The run can still make progress with the tools and context it has.",
      }),
    },
    sessionId: input.runId,
    signal: input.signal,
  });
  if (!result) return { stop: false };
  // Safety-first order: a person, then drift, then a loop. A finish verdict is
  // never asked — that would act in place of a person.
  if (licensed(result.answers.needs_human)) return { stop: true, reason: "needs_human" };
  if (licensed(result.answers.off_track)) return { stop: true, reason: "off_track" };
  if (licensed(result.answers.stuck)) return { stop: true, reason: "loop" };
  return { stop: false };
}

/**
 * Whether a run is repeating work that is not getting anywhere.
 *
 * Prefer `assessRunFloor` at a segment boundary; this keeps the stuck-only
 * reading for callers that only asked that question.
 */
export async function runIsStuck(
  provider: DecisionProvider | undefined,
  input: { goal: string; evidence: string; runId?: string; signal?: AbortSignal },
): Promise<boolean> {
  const floor = await assessRunFloor(provider, input);
  return floor.reason === "loop";
}
