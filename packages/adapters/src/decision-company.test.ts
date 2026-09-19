import { describe, expect, it, vi } from "vitest";
import { suggestCompanyFocus } from "./decision-company.js";
import type { DecisionProvider } from "./jev-decisions.js";

function answering(choice: string, confidence = 0.8): DecisionProvider {
  return {
    decide: vi.fn(async () => ({
      answers: { focus: { type: "choice", choice, confidence } },
      model: "typesafe/jev-1.13",
    })),
  };
}

describe("choosing which company records to read first", () => {
  it("asks nothing without a provider or a task", async () => {
    await expect(suggestCompanyFocus(undefined, { task: "t" })).resolves.toBeUndefined();
    await expect(suggestCompanyFocus(answering("goals"), { task: "  " })).resolves.toBeUndefined();
  });

  it("returns a focus the task can start from", async () => {
    await expect(
      suggestCompanyFocus(answering("customers"), { task: "draft an intro to Acme" }),
    ).resolves.toBe("customers");
  });

  it("ignores an abstain, a hedge, or an invented area", async () => {
    await expect(
      suggestCompanyFocus(answering("none_of_these"), { task: "t" }),
    ).resolves.toBeUndefined();
    await expect(
      suggestCompanyFocus(answering("goals", 0.2), { task: "t" }),
    ).resolves.toBeUndefined();
    await expect(suggestCompanyFocus(answering("payroll"), { task: "t" })).resolves.toBeUndefined();
  });
});
