import { describe, expect, it } from "vitest";
import {
  actionableChoice,
  answerConfidence,
  choice,
  DECISION_CONFIDENCE,
  decisionIsActionable,
  noul,
  score,
} from "./decisions.js";

describe("decision questions", () => {
  it("builds each question type in the shape a decision model answers", () => {
    expect(choice("Which model should serve this run?", { fast: "cheap", strong: null })).toEqual({
      type: "choice",
      instructions: "Which model should serve this run?",
      criteria: { fast: "cheap", strong: null },
    });
    expect(score("How well does this answer the question?", ["unrelated", "exact"])).toMatchObject({
      type: "score",
      criteria: ["unrelated", "exact"],
    });
    expect(noul("Is this urgent?")).toEqual({ type: "noul", instructions: "Is this urgent?" });
    expect(noul("Is this urgent?", { true: "now", false: "later" })).toMatchObject({
      criteria: { true: "now", false: "later" },
    });
  });
});

describe("acting on an answer", () => {
  it("reads confidence, and treats a noul's distance from even odds as its confidence", () => {
    expect(answerConfidence(undefined)).toBe(0);
    expect(answerConfidence({ type: "choice", choice: "a", confidence: 0.7 })).toBe(0.7);
    expect(answerConfidence({ type: "choice", choice: "a" })).toBe(0);
    expect(answerConfidence({ type: "noul", noul: 0.5 })).toBe(0);
    expect(answerConfidence({ type: "noul", noul: 1 })).toBe(1);
    expect(answerConfidence({ type: "noul", noul: 0 })).toBe(1);
  });

  it("keeps the caller's default when the model hedged", () => {
    const hedged = { type: "choice", choice: "a", confidence: 0.2 } as const;
    expect(decisionIsActionable(hedged, DECISION_CONFIDENCE.routing)).toBe(false);
    expect(actionableChoice(hedged, ["a", "b"])).toBeUndefined();
    const firm = { type: "choice", choice: "a", confidence: 0.9 } as const;
    expect(actionableChoice(firm, ["a", "b"])).toBe("a");
  });

  it("refuses an option the caller never offered", () => {
    const answer = { type: "choice", choice: "c", confidence: 0.99 } as const;
    expect(actionableChoice(answer, ["a", "b"])).toBeUndefined();
  });

  it("applies a per-action threshold rather than one global number", () => {
    const answer = { type: "choice", choice: "a", confidence: 0.6 } as const;
    expect(actionableChoice(answer, ["a"], DECISION_CONFIDENCE.advisory)).toBe("a");
    expect(actionableChoice(answer, ["a"], DECISION_CONFIDENCE.routing)).toBe("a");
    expect(actionableChoice(answer, ["a"], DECISION_CONFIDENCE.consequential)).toBeUndefined();
  });

  it("never acts on a score or noul as if it were a choice", () => {
    expect(actionableChoice({ type: "score", score: 4, confidence: 1 }, ["4"])).toBeUndefined();
    expect(actionableChoice({ type: "noul", noul: 1 }, ["true"])).toBeUndefined();
  });
});
