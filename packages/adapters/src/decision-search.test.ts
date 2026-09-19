import type { WebSearchHit } from "@cadre/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { rankWebSearchHits } from "./decision-search.js";
import type { DecisionProvider } from "./jev-decisions.js";

const HITS: WebSearchHit[] = [
  { title: "Unrelated blog", url: "https://a.test", snippet: "cooking" },
  { title: "The answer", url: "https://b.test", snippet: "exactly this" },
  { title: "Adjacent", url: "https://c.test", snippet: "same topic" },
];

function provider(answers: Record<string, unknown>): DecisionProvider {
  return {
    decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })),
  };
}

describe("ranking web search results", () => {
  it("keeps the engine order when no provider is configured", async () => {
    await expect(rankWebSearchHits(undefined, "q", HITS)).resolves.toEqual({
      hits: HITS,
      answered: false,
    });
  });

  it("does not spend a request on a list that cannot be reordered", async () => {
    const decide = vi.fn();
    await rankWebSearchHits({ decide }, "q", HITS.slice(0, 1));
    expect(decide).not.toHaveBeenCalled();
  });

  it("puts the result that answers the question first and drops the noise", async () => {
    const ranked = await rankWebSearchHits(
      provider({
        r0: { type: "score", score: 0, confidence: 0.9 },
        r1: { type: "score", score: 4, confidence: 0.9 },
        r2: { type: "score", score: 2, confidence: 0.9 },
      }),
      "what is the answer",
      HITS,
    );
    expect(ranked.hits.map((hit) => hit.url)).toEqual(["https://b.test", "https://c.test"]);
    expect(ranked.hits[0]).toMatchObject({ relevance: 4 });
    expect(ranked.answered).toBe(false);
  });

  it("sends one request carrying every result and the sufficiency question", async () => {
    const decide = vi.fn(async (_request: unknown) => ({ answers: {}, model: "m" }));
    await rankWebSearchHits({ decide }, "q", HITS);
    expect(decide).toHaveBeenCalledTimes(1);
    const request = decide.mock.calls[0]![0] as unknown as {
      questions: Record<string, unknown>;
      state: { results: unknown[] };
    };
    expect(Object.keys(request.questions)).toEqual(["r0", "r1", "r2", "answered"]);
    expect(request.state.results).toHaveLength(3);
  });

  it("marks the shortlist as enough when the model is confident", async () => {
    const ranked = await rankWebSearchHits(
      provider({
        r0: { type: "score", score: 4, confidence: 0.9 },
        r1: { type: "score", score: 3, confidence: 0.9 },
        r2: { type: "score", score: 1, confidence: 0.9 },
        answered: { type: "noul", noul: 0.9 },
      }),
      "q",
      HITS,
    );
    expect(ranked.answered).toBe(true);
  });

  it("keeps the engine order when the model scored nothing usable", async () => {
    const ranked = await rankWebSearchHits(provider({}), "q", HITS);
    expect(ranked).toEqual({ hits: HITS, answered: false });
  });

  it("ignores a score the model was not confident about", async () => {
    const ranked = await rankWebSearchHits(
      provider({
        r0: { type: "score", score: 4, confidence: 0.05 },
        r1: { type: "score", score: 3, confidence: 0.9 },
        r2: { type: "score", score: 0, confidence: 0.05 },
      }),
      "q",
      HITS,
    );
    // The confident result leads; the two unscored ones keep their order behind it.
    expect(ranked.hits.map((hit) => hit.url)).toEqual([
      "https://b.test",
      "https://a.test",
      "https://c.test",
    ]);
  });

  it("never returns nothing because the model disliked every result", async () => {
    const ranked = await rankWebSearchHits(
      provider({
        r0: { type: "score", score: 0, confidence: 0.9 },
        r1: { type: "score", score: 0, confidence: 0.9 },
        r2: { type: "score", score: 1, confidence: 0.9 },
      }),
      "q",
      HITS,
    );
    expect(ranked.hits).toHaveLength(3);
    expect(ranked.hits[0]?.url).toBe("https://c.test");
  });

  it("returns the engine's order when the provider is unavailable", async () => {
    const ranked = await rankWebSearchHits({ decide: vi.fn(async () => undefined) }, "q", HITS);
    expect(ranked).toEqual({ hits: HITS, answered: false });
  });
});
