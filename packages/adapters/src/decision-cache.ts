/**
 * Remember an answer for a question that has not changed.
 *
 * A decision is a pure reading of a state: the same questions over the same state return the
 * same answers, and TypeSafe's own measurements show the variation across repeated runs is
 * nil. So a repeat costs a round trip for something already known — and agent loops repeat
 * constantly, because a page that did not change, a tool called twice with the same
 * arguments, and a retried step all present the identical state.
 *
 * The key is the whole request: the model, the state and every question with its criteria.
 * Anything that would change the answer changes the key, so there is no version of this that
 * serves a stale answer for a changed world. What it cannot see is the model itself changing
 * underneath, which is what the expiry is for.
 *
 * Two identical requests in flight at once share one, which is the other half of the saving
 * when a caller fans out over the same state.
 */

import { createHash } from "node:crypto";
import type { DecisionProvider, DecisionRequest, DecisionResult } from "./jev-decisions.js";

const MAX_ENTRIES = 256;
const DEFAULT_TTL_MS = 5 * 60_000;

/** Key order must not matter, or two identical requests would hash differently. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function decisionCacheKey(request: Pick<DecisionRequest, "state" | "questions">): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical({ state: request.state, questions: request.questions })))
    .digest("hex");
}

type Entry = { expires: number; result: Promise<DecisionResult | undefined> };

export class CachedDecisionProvider implements DecisionProvider {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly inner: DecisionProvider,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async decide(request: DecisionRequest): Promise<DecisionResult | undefined> {
    const key = decisionCacheKey(request);
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.now()) {
      // Reinsert so the map stays ordered oldest-first for eviction.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing.result;
    }
    const result = this.inner.decide(request);
    this.entries.delete(key);
    this.entries.set(key, { expires: this.now() + this.ttlMs, result });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    const settled = await result;
    // An unavailable provider is a transient state, not an answer; do not remember it, or one
    // network blip would disable every decision on that state for the whole expiry.
    if (settled === undefined && this.entries.get(key)?.result === result) this.entries.delete(key);
    return settled;
  }
}

export function cached(provider: DecisionProvider, ttlMs?: number): DecisionProvider {
  return new CachedDecisionProvider(provider, ttlMs);
}
