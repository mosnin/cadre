/**
 * Decision provider backed by OpenRouter's Decisions API.
 *
 * The default model is TypeSafe's Jev, a "System One" model: it returns a typed choice and a
 * probability per option instead of text. One request carries many questions, including
 * speculative ones the caller may discard, so a decision point costs one round trip rather
 * than one per question.
 *
 * The vendor lives here and nowhere else. Callers depend on `DecisionProvider`, and when no
 * key is configured `decisionProvider()` returns undefined and every caller keeps the
 * behaviour it had before — no decision model is required to run this product.
 */

import type { DecisionAnswer, DecisionQuestion } from "@rakazo/core";
import { getLogger } from "@rakazo/logging";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = "typesafe/jev-1.13";
const DEFAULT_TIMEOUT_MS = 6_000;
const MAX_ATTEMPTS = 3;
/** Retried because the request never reached a decision, not because the answer was unwelcome. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 529]);

export type DecisionRequest = {
  /** The content to judge. A string, or structured context the questions refer to. */
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  /** Groups related calls for observability. The run id, so a run's decisions stay together. */
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type DecisionResult = {
  answers: Record<string, DecisionAnswer>;
  /** The versioned model that actually answered, which the alias in the request does not give. */
  model: string;
  usage?: { input_tokens: number; output_tokens: number; cost?: number };
};

export interface DecisionProvider {
  decide(request: DecisionRequest): Promise<DecisionResult | undefined>;
}

export function decisionModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.JEV_MODEL?.trim() || DEFAULT_MODEL;
}

function decisionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.JEV_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 500 && value <= 30_000
    ? Math.floor(value)
    : DEFAULT_TIMEOUT_MS;
}

/** An answer is only usable if it names an option that was offered and its numbers hold up. */
function validAnswer(answer: unknown, question: DecisionQuestion): answer is DecisionAnswer {
  if (!answer || typeof answer !== "object") return false;
  const record = answer as Record<string, unknown>;
  const finite = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
  if (record.type === "noul") return finite(record.noul);
  if (record.confidence !== undefined && !finite(record.confidence)) return false;
  if (record.probabilities !== undefined) {
    if (!record.probabilities || typeof record.probabilities !== "object") return false;
    const values = Object.values(record.probabilities as Record<string, unknown>);
    if (!values.every(finite)) return false;
    const total = (values as number[]).reduce((sum, value) => sum + value, 0);
    if (values.length > 0 && Math.abs(total - 1) > 0.02) return false;
  }
  if (record.type === "choice" && question.type === "choice") {
    return typeof record.choice === "string" && Object.hasOwn(question.criteria, record.choice);
  }
  if (record.type === "score" && question.type === "score") {
    return typeof record.score === "number" && Number.isFinite(record.score);
  }
  return false;
}

async function postDecisions(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(DECISIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
          lastError = new Error(`decisions HTTP ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
          continue;
        }
        throw new Error(`decisions HTTP ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      // A caller-cancelled request is not a provider failure and must not be retried.
      if (signal?.aborted) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("decisions unavailable");
}

class OpenRouterDecisionProvider implements DecisionProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly defaultTimeoutMs: number,
  ) {}

  async decide(request: DecisionRequest): Promise<DecisionResult | undefined> {
    const names = Object.keys(request.questions);
    if (names.length === 0) return undefined;
    try {
      const payload = await postDecisions(
        this.apiKey,
        {
          model: this.model,
          state: request.state,
          questions: request.questions,
          ...(request.sessionId ? { session_id: request.sessionId.slice(0, 256) } : {}),
        },
        request.timeoutMs ?? this.defaultTimeoutMs,
        request.signal,
      );
      const raw = (payload.answers ?? {}) as Record<string, unknown>;
      const answers: Record<string, DecisionAnswer> = {};
      for (const name of names) {
        const question = request.questions[name]!;
        // A question that came back unusable is dropped, not guessed at. The caller sees no
        // answer for it and keeps its own default, which is the same path as no provider.
        if (validAnswer(raw[name], question)) answers[name] = raw[name] as DecisionAnswer;
      }
      return {
        answers,
        model: typeof payload.model === "string" ? payload.model : this.model,
        usage: payload.usage as DecisionResult["usage"],
      };
    } catch (error) {
      // A decision is always an optimisation over a working default, so a failure is logged
      // and swallowed rather than failing the run that asked.
      getLogger().warn("decisions.unavailable", {
        model: this.model,
        questions: names.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

/**
 * The configured provider, or undefined when none is. Callers treat undefined as "decide it
 * yourself": no feature depends on a decision model being present.
 */
export function decisionProvider(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProvider | undefined {
  if (env.JEV_DECISIONS_ENABLED === "0") return undefined;
  const apiKey = env.JEV_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new OpenRouterDecisionProvider(apiKey, decisionModel(env), decisionTimeoutMs(env));
}

export { validAnswer as validDecisionAnswer };
