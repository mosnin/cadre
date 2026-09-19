import { describe, expect, it, vi } from "vitest";
import { CachedDecisionProvider, decisionCacheKey } from "./decision-cache.js";
import type { DecisionProvider } from "./jev-decisions.js";

const QUESTIONS = { q: { type: "noul" as const, instructions: "Is it so?" } };
const ANSWER = { answers: { q: { type: "noul" as const, noul: 0.9 } }, model: "jev-1.13" };

function counting() {
  const decide = vi.fn(async () => ANSWER);
  return { provider: { decide } as DecisionProvider, decide };
}

function silent() {
  const decide = vi.fn(async () => undefined);
  return { provider: { decide } as DecisionProvider, decide };
}

describe("the key an answer is remembered under", () => {
  it("ignores the order the state was written in", () => {
    expect(
      decisionCacheKey({ state: { a: 1, b: [2, { c: 3, d: 4 }] }, questions: QUESTIONS }),
    ).toBe(decisionCacheKey({ state: { b: [2, { d: 4, c: 3 }], a: 1 }, questions: QUESTIONS }));
  });

  it("changes when anything the model would read changes", () => {
    const base = { state: { page: "one" }, questions: QUESTIONS };
    expect(decisionCacheKey(base)).not.toBe(decisionCacheKey({ ...base, state: { page: "two" } }));
    expect(decisionCacheKey(base)).not.toBe(
      decisionCacheKey({
        ...base,
        questions: { q: { type: "noul", instructions: "Is it otherwise?" } },
      }),
    );
  });
});

describe("repeating a decision that has not changed", () => {
  it("asks once, however many times the same state comes back round", async () => {
    const { provider, decide } = counting();
    const cache = new CachedDecisionProvider(provider);
    const request = { state: { page: "one" }, questions: QUESTIONS };
    await expect(cache.decide(request)).resolves.toEqual(ANSWER);
    await expect(cache.decide({ ...request })).resolves.toEqual(ANSWER);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("shares one request between callers that ask at the same moment", async () => {
    const { provider, decide } = counting();
    const cache = new CachedDecisionProvider(provider);
    const request = { state: { page: "one" }, questions: QUESTIONS };
    await Promise.all([cache.decide(request), cache.decide(request), cache.decide(request)]);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it("asks again for a state that moved on", async () => {
    const { provider, decide } = counting();
    const cache = new CachedDecisionProvider(provider);
    await cache.decide({ state: { page: "one" }, questions: QUESTIONS });
    await cache.decide({ state: { page: "two" }, questions: QUESTIONS });
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("asks again once the answer has been held long enough", async () => {
    const { provider, decide } = counting();
    let now = 1_000;
    const cache = new CachedDecisionProvider(provider, 60_000, () => now);
    const request = { state: { page: "one" }, questions: QUESTIONS };
    await cache.decide(request);
    now += 60_001;
    await cache.decide(request);
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it("never remembers an unavailable provider, so one blip is not five minutes of silence", async () => {
    const { provider, decide } = silent();
    const cache = new CachedDecisionProvider(provider);
    const request = { state: { page: "one" }, questions: QUESTIONS };
    await expect(cache.decide(request)).resolves.toBeUndefined();
    await cache.decide(request);
    expect(decide).toHaveBeenCalledTimes(2);
  });
});
