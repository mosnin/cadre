import { describe, expect, it, vi } from "vitest";
import { assessRunFloor, runIsStuck } from "./decision-guards.js";
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

describe("the factory floor at a segment boundary", () => {
  it("asks the stuck, off-track, and needs-human questions together", async () => {
    const provider = answering({
      stuck: { type: "noul", noul: 0.1 },
      off_track: { type: "noul", noul: 0.1 },
      needs_human: { type: "noul", noul: 0.95 },
    });
    await expect(assessRunFloor(provider, { goal: "g", evidence: TRAIL })).resolves.toEqual({
      stop: true,
      reason: "needs_human",
    });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions)).toEqual(["stuck", "off_track", "needs_human"]);
  });

  it("never stops on a hedge", async () => {
    await expect(
      assessRunFloor(
        answering({
          stuck: { type: "noul", noul: 0.7 },
          off_track: { type: "noul", noul: 0.7 },
          needs_human: { type: "noul", noul: 0.7 },
        }),
        { goal: "g", evidence: TRAIL },
      ),
    ).resolves.toEqual({ stop: false });
  });
});
