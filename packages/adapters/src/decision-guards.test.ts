import { describe, expect, it, vi } from "vitest";
import { runIsStuck } from "./decision-guards.js";
import type { DecisionProvider } from "./jev-decisions.js";

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}
const unavailable: DecisionProvider = { decide: vi.fn(async () => undefined) };

/** Long enough to clear the evidence floor. */
const TRAIL = "tried the same export and it failed. ".repeat(12);

describe("detecting a run that is not getting anywhere", () => {
  it("declines to judge a trail too short to read", async () => {
    const provider = answering({ stuck: { type: "noul", noul: 1 } });
    await expect(runIsStuck(provider, { goal: "g", evidence: "just started" })).resolves.toBe(
      false,
    );
    expect(provider.decide).not.toHaveBeenCalled();
  });

  it("stops the run only on a confident yes", async () => {
    await expect(
      runIsStuck(answering({ stuck: { type: "noul", noul: 0.95 } }), {
        goal: "g",
        evidence: TRAIL,
      }),
    ).resolves.toBe(true);
    await expect(
      runIsStuck(answering({ stuck: { type: "noul", noul: 0.75 } }), {
        goal: "g",
        evidence: TRAIL,
      }),
    ).resolves.toBe(false);
  });

  it("lets the run continue when the provider is unavailable", async () => {
    await expect(runIsStuck(unavailable, { goal: "g", evidence: TRAIL })).resolves.toBe(false);
  });
});
