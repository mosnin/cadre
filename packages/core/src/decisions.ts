/**
 * Typed decisions: the question shapes a decision model answers, and the rules for acting on
 * an answer.
 *
 * A decision model is not a chat model. It never returns prose: it is handed a state and a set
 * of typed questions, and it returns one option per question plus a calibrated probability for
 * every option. That makes it right for the points where this product already needs a small,
 * fast, predictable judgement — which model serves a run, which result answers a search, which
 * control to operate next — and wrong for anything that has to be written.
 *
 * Nothing here talks to a provider. The shapes live in core so callers can build questions and
 * read answers without depending on whether a decision provider is configured at all.
 */

/** A question's guidance. Structure is allowed: a provider reads JSON as readily as a string. */
export type DecisionGuidance = string | Record<string, unknown> | unknown[];

export type ChoiceQuestion = {
  type: "choice";
  instructions: DecisionGuidance;
  /** Option id to its description. The answer is always one of these keys. */
  criteria: Record<string, DecisionGuidance | null>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: DecisionGuidance;
  /** Ordered levels, lowest first. */
  criteria: DecisionGuidance[];
};

export type NoulQuestion = {
  type: "noul";
  instructions: DecisionGuidance;
  criteria?: { true: DecisionGuidance; false: DecisionGuidance };
};

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  legend?: Record<string, DecisionGuidance>;
};

/** A noul answers a yes/no question with the probability that it is true. */
export type NoulAnswer = { type: "noul"; noul: number };

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export function choice(
  instructions: DecisionGuidance,
  criteria: Record<string, DecisionGuidance | null>,
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

export function score(instructions: DecisionGuidance, criteria: DecisionGuidance[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

export function noul(
  instructions: DecisionGuidance,
  criteria?: { true: DecisionGuidance; false: DecisionGuidance },
): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

/**
 * Confidence is not probability. A probability says how the options compare; confidence says
 * whether the model had enough to go on at all. An answer can put 0.9 on one option and still
 * carry low confidence, which is exactly the case where the caller should not act.
 *
 * Thresholds belong to the caller, per action and per risk: a search reordering and a run that
 * spends money do not share one number.
 */
export const DECISION_CONFIDENCE = {
  /** Reordering, ranking, and other choices a person can ignore. */
  advisory: 0.35,
  /** Picking a model, a handler, or a next step the run then acts on. */
  routing: 0.55,
  /** Anything that touches the outside world without a person watching. */
  consequential: 0.8,
} as const;

export function answerConfidence(answer: DecisionAnswer | undefined): number {
  if (!answer) return 0;
  if (answer.type === "noul") {
    // A noul carries no confidence field; distance from even odds is the closest honest proxy.
    return Math.abs(answer.noul - 0.5) * 2;
  }
  return typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
    ? answer.confidence
    : 0;
}

/** Whether an answer is firm enough to act on. Below the threshold, callers keep their default. */
export function decisionIsActionable(
  answer: DecisionAnswer | undefined,
  threshold: number = DECISION_CONFIDENCE.routing,
): boolean {
  return answerConfidence(answer) >= threshold;
}

/**
 * The choice to act on, or undefined to keep the caller's own default. Every integration goes
 * through this rather than reading `answer.choice` directly, so an unconfigured provider, a
 * hedged answer and an option the caller did not offer all land on the same safe path.
 */
export function actionableChoice(
  answer: DecisionAnswer | undefined,
  allowed: readonly string[],
  threshold: number = DECISION_CONFIDENCE.routing,
): string | undefined {
  if (answer?.type !== "choice") return undefined;
  if (!allowed.includes(answer.choice)) return undefined;
  return decisionIsActionable(answer, threshold) ? answer.choice : undefined;
}

/**
 * An option list that may not cover the input needs somewhere to land, or the model is forced
 * to pick a wrong answer. Callers treat this choice as "no decision".
 */
export const DECISION_ABSTAIN = "none_of_these";
