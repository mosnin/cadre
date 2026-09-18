import { describe, expect, it, vi } from "vitest";
import { runDecisionReview } from "./auto-review.js";
import type { DecisionProvider } from "./jev-decisions.js";

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

const CALL = {
  toolName: "send_invoice",
  connectorKind: "acme",
  args: { to: "someone@example.test" },
  userTask: "summarise last week",
  botDescription: "Reporter: writes weekly summaries",
  matchingRules: [],
};

describe("reviewing a tool call without a generation", () => {
  it("hands back to the generative judge without a provider", async () => {
    await expect(runDecisionReview(undefined, CALL)).resolves.toBeUndefined();
  });

  it("asks the verdict and the concern in one request", async () => {
    const provider = answering({});
    await runDecisionReview(provider, CALL);
    expect(provider.decide).toHaveBeenCalledTimes(1);
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions).sort()).toEqual(["concern", "decision"]);
  });

  it("turns the concern category into a reason nobody had to write", async () => {
    const result = await runDecisionReview(
      answering({
        decision: { type: "choice", choice: "ask", confidence: 0.8 },
        concern: { type: "choice", choice: "outside_task", confidence: 0.7 },
      }),
      CALL,
    );
    expect(result).toMatchObject({ decision: "ask", reason: "This looks unrelated to the task." });
    expect(result?.model).toContain("typesafe/jev-1.13");
  });

  it("still asks when the concern itself is unclear", async () => {
    const result = await runDecisionReview(
      answering({ decision: { type: "choice", choice: "ask", confidence: 0.8 } }),
      CALL,
    );
    expect(result).toMatchObject({ decision: "ask", reason: "This action needs a look first." });
  });

  it("passes only on a firm verdict, because letting one through is the costlier error", async () => {
    await expect(
      runDecisionReview(
        answering({ decision: { type: "choice", choice: "pass", confidence: 0.9 } }),
        CALL,
      ),
    ).resolves.toMatchObject({ decision: "pass" });
    // Confident enough to have asked, not confident enough to wave through.
    await expect(
      runDecisionReview(
        answering({ decision: { type: "choice", choice: "pass", confidence: 0.6 } }),
        CALL,
      ),
    ).resolves.toBeUndefined();
  });

  it("hands back rather than guessing when the model will not commit", async () => {
    await expect(
      runDecisionReview(
        answering({ decision: { type: "choice", choice: "ask", confidence: 0.1 } }),
        CALL,
      ),
    ).resolves.toBeUndefined();
    await expect(
      runDecisionReview({ decide: vi.fn(async () => undefined) }, CALL),
    ).resolves.toBeUndefined();
  });
});
