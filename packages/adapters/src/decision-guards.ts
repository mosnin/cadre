/**
 * Judgements that protect a run, answered by a decision model.
 *
 * Each of these replaces a guess with a read, or avoids work entirely. None of
 * them can weaken an existing guard: a decision may raise an approval bar, stop
 * a run, or skip an occurrence, and never the reverse. Without a provider, or
 * when the model will not commit, every one returns the caller's own answer.
 */

import { actionableChoice, DECISION_CONFIDENCE, type NoulAnswer, noul } from "@rakazo/core";
import type { DecisionProvider } from "./jev-decisions.js";

const MAX_ARGS_CHARS = 1_200;

function probability(answer: unknown): number | undefined {
  const noulAnswer = answer as NoulAnswer | undefined;
  if (!noulAnswer || noulAnswer.type !== "noul") return undefined;
  return typeof noulAnswer.noul === "number" && Number.isFinite(noulAnswer.noul)
    ? noulAnswer.noul
    : undefined;
}

/**
 * Whether a connector call the name check cleared is consequential after all.
 *
 * Approval is decided from the tool's *name* by regex. That has been wrong twice
 * in this codebase already, because a name is a label the connector's author
 * chose and nothing forces it to describe what the call does. This reads the
 * call instead.
 *
 * It is asked only for connector tools the name already cleared, so it is the
 * one place the regex can be wrong in the dangerous direction, and it can only
 * return true. A tool the name flagged is never handed back for reconsideration.
 */
export async function escalateConnectorConsequence(
  provider: DecisionProvider | undefined,
  input: {
    toolName: string;
    connectorKind: string;
    args: Record<string, unknown>;
    runId?: string;
    signal?: AbortSignal;
  },
): Promise<boolean> {
  if (!provider) return false;
  const result = await provider.decide({
    state: {
      tool: input.toolName,
      connector: input.connectorKind,
      arguments: JSON.stringify(input.args).slice(0, MAX_ARGS_CHARS),
    },
    questions: {
      consequential: noul(
        "Does this call change something outside this workspace, spend money, send data to a third party, or destroy data?",
        {
          true: "It writes, sends, pays, deletes, or otherwise has an effect someone would notice.",
          false: "It only reads or searches, and leaves everything as it was.",
        },
      ),
    },
    sessionId: input.runId,
    signal: input.signal,
  });
  const value = probability(result?.answers.consequential);
  // Only a confident "yes" raises the bar. Silence, doubt, or a "no" all leave
  // the name check's verdict exactly where it was.
  return value !== undefined && value >= DECISION_CONFIDENCE.consequential;
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

/**
 * Whether a scheduled occurrence has anything to do.
 *
 * A routine that reports on a project costs a full agent run whether or not
 * anything changed since the last one. Reading a cheap summary of what changed
 * and skipping the run is the largest saving available to a fleet of schedules,
 * because the run it avoids is the whole cost.
 *
 * It fails toward running: nothing but a confident "there is no work" skips an
 * occurrence, because a skipped run that should have happened is invisible.
 */
export async function routineHasWork(
  provider: DecisionProvider | undefined,
  input: { instruction: string; since: string; runId?: string; signal?: AbortSignal },
): Promise<boolean> {
  if (!provider || !input.since.trim()) return true;
  const result = await provider.decide({
    state: {
      routine: input.instruction.slice(0, 2_000),
      changed_since_last_run: input.since.slice(0, 4_000),
    },
    questions: {
      work: noul("Given what has changed, does this routine have anything to do this time?", {
        true: "There is new or outstanding work this routine would act on.",
        false:
          "Nothing has changed that this routine would act on; running it would repeat the last result.",
      }),
    },
    sessionId: input.runId,
    signal: input.signal,
  });
  const value = probability(result?.answers.work);
  if (value === undefined) return true;
  return value > 1 - DECISION_CONFIDENCE.consequential;
}

/**
 * Which teammate should take a handoff.
 *
 * The model picks a peer today by reading the bot directory in its prompt and
 * writing a name, which is a choice over a known list dressed as free text.
 */
export async function chooseHandoffBot(
  provider: DecisionProvider | undefined,
  input: {
    stage: string;
    candidates: { id: string; description: string }[];
    runId?: string;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  if (!provider || input.candidates.length < 2) return undefined;
  const result = await provider.decide({
    state: { work_to_hand_off: input.stage.slice(0, 2_000) },
    questions: {
      bot: {
        type: "choice",
        instructions: {
          task: "Which teammate should own this next stage?",
          rules: ["Choose the one whose stated role covers this work."],
        },
        criteria: Object.fromEntries(
          input.candidates.map((candidate) => [candidate.id, candidate.description.slice(0, 400)]),
        ),
      },
    },
    sessionId: input.runId,
    signal: input.signal,
  });
  return actionableChoice(
    result?.answers.bot,
    input.candidates.map((candidate) => candidate.id),
    DECISION_CONFIDENCE.routing,
  );
}
