import { describe, expect, it, vi } from "vitest";
import {
  decideRunStart,
  extractTaskUrls,
  needsComputerBeforeFirstGeneration,
  searchQueryForStart,
  skillsImpliedByStart,
  toolNeedsComputer,
} from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";

const POOL = [
  { model: "qwen/qwen3-8b", description: "Cheap." },
  { model: "qwen/qwen3-235b-a22b", description: "Strong." },
];
const SKILLS = [
  { name: "symbolic", description: "Judge a diff." },
  { name: "company-context", description: "Read company records." },
];

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

describe("extracting URLs from a task", () => {
  it("returns unique http(s) addresses and drops trailing punctuation", () => {
    expect(extractTaskUrls("see https://a.test/x), and https://a.test/x again.")).toEqual([
      "https://a.test/x",
    ]);
    expect(extractTaskUrls("no links here")).toEqual([]);
  });
});

describe("deciding a run from one request", () => {
  it("asks nothing without a provider or a task", async () => {
    await expect(decideRunStart(undefined, { task: "t", candidates: POOL })).resolves.toEqual({});
    await expect(decideRunStart(answering({}), { task: "  " })).resolves.toEqual({});
  });

  it("asks every applicable question in one request", async () => {
    const provider = answering({});
    await decideRunStart(provider, {
      task: "Read https://docs.example/a and check the auth module",
      candidates: POOL,
      skills: SKILLS,
      company: true,
    });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions)).toEqual([
      "first",
      "model",
      "needed",
      "skill",
      "focus",
      "fetch_url",
    ]);
  });

  it("returns the fields the model committed to", async () => {
    const start = await decideRunStart(
      answering({
        first: { type: "choice", choice: "fetch", confidence: 0.9 },
        model: { type: "choice", choice: "qwen/qwen3-8b", confidence: 0.9 },
        needed: { type: "noul", noul: 0.9 },
        skill: { type: "choice", choice: "symbolic", confidence: 0.8 },
        focus: { type: "choice", choice: "product", confidence: 0.8 },
        fetch_url: { type: "choice", choice: "https://docs.example/a", confidence: 0.9 },
      }),
      {
        task: "Read https://docs.example/a",
        candidates: POOL,
        fallbackModel: "qwen/qwen3-235b-a22b",
        skills: SKILLS,
        company: true,
      },
    );
    expect(start).toEqual({
      first: "fetch",
      model: "qwen/qwen3-8b",
      skill: "symbolic",
      companyFocus: "product",
      fetchUrl: "https://docs.example/a",
    });
  });

  it("ignores a hedge, an abstain, and a model the run would have used anyway", async () => {
    const start = await decideRunStart(
      answering({
        first: { type: "choice", choice: "none_of_these", confidence: 0.99 },
        model: { type: "choice", choice: "qwen/qwen3-235b-a22b", confidence: 0.99 },
        needed: { type: "noul", noul: 0.2 },
        skill: { type: "choice", choice: "symbolic", confidence: 0.99 },
        focus: { type: "choice", choice: "goals", confidence: 0.2 },
      }),
      {
        task: "t",
        candidates: POOL,
        fallbackModel: "qwen/qwen3-235b-a22b",
        skills: SKILLS,
        company: true,
      },
    );
    expect(start).toEqual({});
  });
});

describe("what a start decision already paid for", () => {
  it("uses the user's wording as a search query only when it is already a query", () => {
    expect(searchQueryForStart("  weather in paris  ")).toBe("weather in paris");
    expect(searchQueryForStart("")).toBeUndefined();
    expect(searchQueryForStart("x".repeat(401))).toBeUndefined();
  });

  it("names the skill bodies that should be injected instead of read", () => {
    expect(skillsImpliedByStart({ skill: "symbolic", first: "code" })).toEqual(["symbolic"]);
    expect(skillsImpliedByStart({ first: "company" })).toEqual(["company-context"]);
    expect(skillsImpliedByStart({ companyFocus: "goals" })).toEqual(["company-context"]);
    expect(skillsImpliedByStart({ first: "answer" })).toEqual([]);
  });

  it("waits for the computer only when the first step needs the machine now", () => {
    expect(needsComputerBeforeFirstGeneration("answer", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("search", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("fetch", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("skill", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("company", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("code", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration(undefined, false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("browse", false)).toBe(true);
    expect(needsComputerBeforeFirstGeneration("computer", false)).toBe(false);
    expect(needsComputerBeforeFirstGeneration("answer", true)).toBe(true);
  });

  it("waits for the computer only on tools that touch the workspace", () => {
    expect(toolNeedsComputer("web_search")).toBe(false);
    expect(toolNeedsComputer("web_fetch")).toBe(false);
    expect(toolNeedsComputer("message_user")).toBe(false);
    expect(toolNeedsComputer("skill_read")).toBe(false);
    expect(toolNeedsComputer("render_plot", { help: true })).toBe(false);
    expect(toolNeedsComputer("render_plot", { spec: { marks: [] } })).toBe(true);
    expect(toolNeedsComputer("shell")).toBe(true);
    expect(toolNeedsComputer("browser_pursue")).toBe(true);
    expect(toolNeedsComputer("read_file")).toBe(true);
  });
});
