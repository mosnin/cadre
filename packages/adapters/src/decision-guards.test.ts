import { describe, expect, it, vi } from "vitest";
import { chooseHandoffBot, routineHasWork, runIsStuck } from "./decision-guards.js";
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

describe("skipping a scheduled occurrence", () => {
  it("runs when there is nothing to compare against", async () => {
    await expect(
      routineHasWork(answering({ idle: { type: "noul", noul: 1 } }), {
        instruction: "report status",
        since: "   ",
      }),
    ).resolves.toBe(true);
  });

  it("asks whether there is nothing to do, not the opposite of it", async () => {
    const provider = answering({});
    await routineHasWork(provider, { instruction: "report status", since: "no commits" });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    // This model does not promise that a statement and its negation sum to one, so the
    // statement that licenses the skip has to be the statement that was asked.
    expect(Object.keys(request.questions)).toEqual(["idle"]);
  });

  it("skips only on a confident nothing-to-do", async () => {
    const input = { instruction: "report status", since: "no commits, no new issues" };
    await expect(
      routineHasWork(answering({ idle: { type: "noul", noul: 0.95 } }), input),
    ).resolves.toBe(false);
    // Unsure means run: a skipped occurrence that should have happened is invisible.
    await expect(
      routineHasWork(answering({ idle: { type: "noul", noul: 0.7 } }), input),
    ).resolves.toBe(true);
    await expect(
      routineHasWork(answering({ idle: { type: "noul", noul: 0.05 } }), input),
    ).resolves.toBe(true);
  });

  it("runs when the provider is unavailable or silent", async () => {
    const input = { instruction: "report status", since: "something" };
    await expect(routineHasWork(unavailable, input)).resolves.toBe(true);
    await expect(routineHasWork(answering({}), input)).resolves.toBe(true);
    await expect(routineHasWork(undefined, input)).resolves.toBe(true);
  });
});

describe("choosing who takes a handoff", () => {
  const candidates = [
    { id: "bot-a", description: "Writes copy." },
    { id: "bot-b", description: "Runs the numbers." },
  ];

  it("declines when there is no real choice", async () => {
    await expect(
      chooseHandoffBot(answering({}), { stage: "s", candidates: candidates.slice(0, 1) }),
    ).resolves.toBeUndefined();
  });

  it("picks a teammate it is confident about", async () => {
    await expect(
      chooseHandoffBot(answering({ bot: { type: "choice", choice: "bot-b", confidence: 0.9 } }), {
        stage: "forecast next quarter",
        candidates,
      }),
    ).resolves.toBe("bot-b");
  });

  it("refuses a hedged pick or one that is not a candidate", async () => {
    await expect(
      chooseHandoffBot(answering({ bot: { type: "choice", choice: "bot-b", confidence: 0.2 } }), {
        stage: "s",
        candidates,
      }),
    ).resolves.toBeUndefined();
    await expect(
      chooseHandoffBot(answering({ bot: { type: "choice", choice: "bot-z", confidence: 0.99 } }), {
        stage: "s",
        candidates,
      }),
    ).resolves.toBeUndefined();
  });
});
