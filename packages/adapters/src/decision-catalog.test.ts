import { describe, expect, it, vi } from "vitest";
import { rankCatalogHits } from "./decision-catalog.js";

const HITS = [
  { id: "a", name: "list_releases", description: "List GitHub releases", readOnly: true },
  { id: "b", name: "send_mail", description: "Send an email", readOnly: false },
];

function scored(score: number, confidence = 0.8) {
  return { type: "score" as const, score, confidence };
}

describe("ranking catalog hits", () => {
  it("keeps the keyword order without a provider or a real shortlist", async () => {
    await expect(rankCatalogHits(undefined, "releases", HITS)).resolves.toEqual(HITS);
    await expect(
      rankCatalogHits({ decide: vi.fn() }, "releases", HITS.slice(0, 1)),
    ).resolves.toEqual(HITS.slice(0, 1));
  });

  it("puts the tool that fits the query first", async () => {
    const ranked = await rankCatalogHits(
      {
        decide: vi.fn(async () => ({
          answers: { t0: scored(3), t1: scored(0) },
          model: "m",
        })),
      },
      "list releases",
      HITS,
    );
    expect(ranked.map((hit) => hit.id)).toEqual(["a", "b"]);
  });

  it("leaves the keyword order when every score is a hedge", async () => {
    const ranked = await rankCatalogHits(
      {
        decide: vi.fn(async () => ({
          answers: { t0: scored(3, 0.1), t1: scored(0, 0.1) },
          model: "m",
        })),
      },
      "list releases",
      HITS,
    );
    expect(ranked).toEqual(HITS);
  });
});
