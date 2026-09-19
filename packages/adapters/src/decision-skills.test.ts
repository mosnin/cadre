import { describe, expect, it, vi } from "vitest";
import { suggestSkill } from "./decision-skills.js";
import type { DecisionProvider } from "./jev-decisions.js";

const SKILLS = [
  { name: "company-context", description: "Read company records before acting." },
  { name: "symbolic", description: "Judge a diff, find files, or triage failures." },
];

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

describe("suggesting a catalog skill", () => {
  it("asks nothing without a provider, a task, or a catalog", async () => {
    await expect(suggestSkill(undefined, { task: "t", skills: SKILLS })).resolves.toBeUndefined();
    await expect(
      suggestSkill(answering({}), { task: "   ", skills: SKILLS }),
    ).resolves.toBeUndefined();
    await expect(suggestSkill(answering({}), { task: "t", skills: [] })).resolves.toBeUndefined();
  });

  it("names a skill only when the request needs one and the choice is firm", async () => {
    const chosen = await suggestSkill(
      answering({
        needed: { type: "noul", noul: 0.9 },
        skill: { type: "choice", choice: "symbolic", confidence: 0.8 },
      }),
      { task: "check this diff", skills: SKILLS },
    );
    expect(chosen).toBe("symbolic");
  });

  it("keeps the catalog closed when a skill is not needed", async () => {
    await expect(
      suggestSkill(
        answering({
          needed: { type: "noul", noul: 0.2 },
          skill: { type: "choice", choice: "symbolic", confidence: 0.9 },
        }),
        { task: "what time is it", skills: SKILLS },
      ),
    ).resolves.toBeUndefined();
  });

  it("ignores an abstain or a skill that was never offered", async () => {
    await expect(
      suggestSkill(
        answering({
          needed: { type: "noul", noul: 0.9 },
          skill: { type: "choice", choice: "none_of_these", confidence: 0.9 },
        }),
        { task: "t", skills: SKILLS },
      ),
    ).resolves.toBeUndefined();
    await expect(
      suggestSkill(
        answering({
          needed: { type: "noul", noul: 0.9 },
          skill: { type: "choice", choice: "invented", confidence: 0.9 },
        }),
        { task: "t", skills: SKILLS },
      ),
    ).resolves.toBeUndefined();
  });
});
