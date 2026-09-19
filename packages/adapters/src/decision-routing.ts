/**
 * Choose which model serves a run.
 *
 * Most turns do not need the strongest model available. A short reply, a lookup, or a routine
 * status check costs the same as a hard multi-step task when one model serves everything, and
 * the difference between a cheap model and a frontier one is most of the bill.
 *
 * A decision model reads the task and picks from a configured pool. It costs a fraction of a
 * cent and returns a calibrated probability, so a task it cannot place confidently falls back
 * to the deployment default rather than being sent somewhere cheap and failing.
 *
 * The pool is configuration, not code: `JEV_ROUTER_MODELS` is a JSON array of candidates, each
 * with the description the model reads. Unset uses the Qwen cheap/strong pair. An explicit
 * empty array or `0` turns routing off.
 */

import { getLogger } from "@cadre/logging";
import { decideRunStart } from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";

export type ModelCandidate = {
  /** Provider model id, exactly as the run would otherwise request it. */
  model: string;
  /** What this model is for. The decision model reads this and nothing else about it. */
  description: string;
};

const MAX_CANDIDATES = 12;

/** Qwen through OpenRouter: cheap for short work, strong for the rest. */
export const DEFAULT_ROUTER_MODELS: ModelCandidate[] = [
  {
    model: "qwen/qwen3-8b",
    description: "Cheap and fast. Short answers, lookups, summaries.",
  },
  {
    model: "qwen/qwen3-235b-a22b",
    description: "Strong reasoning. Long multi-step work and code.",
  },
];

export function routerCandidates(env: NodeJS.ProcessEnv = process.env): ModelCandidate[] {
  const raw = env.JEV_ROUTER_MODELS?.trim();
  // Unset uses the Qwen pool. An explicit empty array or "0" turns routing off.
  if (!raw) return DEFAULT_ROUTER_MODELS;
  if (raw === "0" || raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const candidates: ModelCandidate[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { model, description } = entry as Record<string, unknown>;
      if (typeof model !== "string" || !model.trim()) continue;
      if (typeof description !== "string" || !description.trim()) continue;
      candidates.push({ model: model.trim(), description: description.trim() });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    return candidates;
  } catch {
    // A malformed pool routes nothing rather than routing wrongly.
    getLogger().warn("decisions.router_pool_invalid");
    return [];
  }
}

/**
 * The model to serve this task, or undefined to keep the caller's default.
 *
 * Routing is consequential — it changes what the user pays for and how well the task goes — so
 * it takes the routing threshold rather than the advisory one, and a hedged answer keeps the
 * default.
 */
export async function routeRunModel(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    candidates: ModelCandidate[];
    /** Offered alongside the pool so the model can decline to move off it. */
    fallbackModel?: string;
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  if (!provider || input.candidates.length < 2) return undefined;
  const start = await decideRunStart(provider, {
    task: input.task,
    candidates: input.candidates,
    fallbackModel: input.fallbackModel,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  return start.model;
}
