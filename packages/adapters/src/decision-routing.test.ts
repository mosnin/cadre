import { describe, expect, it, vi } from "vitest";
import { type ModelCandidate, routeRunModel, routerCandidates } from "./decision-routing.js";
import type { DecisionProvider } from "./jev-decisions.js";

const POOL: ModelCandidate[] = [
  { model: "qwen/qwen3-8b", description: "Cheap and fast. Short answers, lookups, summaries." },
  { model: "qwen/qwen3-235b", description: "Strong reasoning. Long multi-step work and code." },
];

function provider(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

describe("the router pool", () => {
  it("is empty unless configured, so nothing routes by default", () => {
    expect(routerCandidates({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("reads candidates and their descriptions from configuration", () => {
    const env = { JEV_ROUTER_MODELS: JSON.stringify(POOL) } as NodeJS.ProcessEnv;
    expect(routerCandidates(env)).toEqual(POOL);
  });

  it("routes nothing rather than wrongly when the pool is malformed", () => {
    expect(routerCandidates({ JEV_ROUTER_MODELS: "{not json" } as NodeJS.ProcessEnv)).toEqual([]);
    expect(routerCandidates({ JEV_ROUTER_MODELS: '"a string"' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("skips entries missing a model id or a description", () => {
    const env = {
      JEV_ROUTER_MODELS: JSON.stringify([
        { model: "a/b" },
        { description: "no model" },
        { model: "  ", description: "blank" },
        POOL[0],
      ]),
    } as NodeJS.ProcessEnv;
    expect(routerCandidates(env)).toEqual([POOL[0]]);
  });
});

describe("routing a run to a model", () => {
  it("keeps the default without a provider or without a real choice", async () => {
    await expect(
      routeRunModel(undefined, { task: "t", candidates: POOL }),
    ).resolves.toBeUndefined();
    await expect(
      routeRunModel(provider({}), { task: "t", candidates: POOL.slice(0, 1) }),
    ).resolves.toBeUndefined();
    await expect(
      routeRunModel(provider({}), { task: "   ", candidates: POOL }),
    ).resolves.toBeUndefined();
  });

  it("sends the task and offers every candidate by id", async () => {
    const decide = vi.fn(async (_request: unknown) => ({ answers: {}, model: "m" }));
    await routeRunModel({ decide }, { task: "summarise this page", candidates: POOL });
    const request = decide.mock.calls[0]![0] as unknown as {
      state: { task: string };
      questions: { model: { criteria: Record<string, string> } };
    };
    expect(request.state.task).toBe("summarise this page");
    expect(Object.keys(request.questions.model.criteria)).toEqual([
      "qwen/qwen3-8b",
      "qwen/qwen3-235b",
    ]);
  });

  it("moves a simple task onto the cheap model", async () => {
    const chosen = await routeRunModel(
      provider({ model: { type: "choice", choice: "qwen/qwen3-8b", confidence: 0.9 } }),
      { task: "what is the capital of France", candidates: POOL, fallbackModel: "qwen/qwen3-235b" },
    );
    expect(chosen).toBe("qwen/qwen3-8b");
  });

  it("keeps the default when the model picked it anyway", async () => {
    const chosen = await routeRunModel(
      provider({ model: { type: "choice", choice: "qwen/qwen3-235b", confidence: 0.95 } }),
      { task: "refactor the auth module", candidates: POOL, fallbackModel: "qwen/qwen3-235b" },
    );
    expect(chosen).toBeUndefined();
  });

  it("keeps the default on a hedged decision rather than gambling on a cheap model", async () => {
    const chosen = await routeRunModel(
      provider({ model: { type: "choice", choice: "qwen/qwen3-8b", confidence: 0.3 } }),
      { task: "something ambiguous", candidates: POOL },
    );
    expect(chosen).toBeUndefined();
  });

  it("refuses a model that was never in the pool", async () => {
    const chosen = await routeRunModel(
      provider({ model: { type: "choice", choice: "openai/gpt-5", confidence: 0.99 } }),
      { task: "t", candidates: POOL },
    );
    expect(chosen).toBeUndefined();
  });

  it("keeps the default when the provider is unavailable", async () => {
    const chosen = await routeRunModel(
      { decide: vi.fn(async () => undefined) },
      { task: "t", candidates: POOL },
    );
    expect(chosen).toBeUndefined();
  });
});
