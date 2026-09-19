import { describe, expect, it, vi } from "vitest";
import { rankMemoryDocuments } from "./decision-memory.js";
import type { DecisionProvider } from "./jev-decisions.js";

const DOCS = [
  { scope: "user", path: "recent-note.md", content: "bought milk on tuesday" },
  { scope: "bot", path: "deploy.md", content: "production deploys need the release checklist" },
  { scope: "user", path: "profile.md", content: "prefers metric units" },
];

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}
const scored = (value: number, confidence = 0.8) => ({ type: "score", score: value, confidence });

describe("ordering durable memory by what the task needs", () => {
  it("keeps the caller's order without a provider or a task", async () => {
    await expect(rankMemoryDocuments(undefined, { task: "deploy", documents: DOCS })).resolves.toBe(
      DOCS,
    );
    await expect(
      rankMemoryDocuments(answering({}), { task: "   ", documents: DOCS }),
    ).resolves.toBe(DOCS);
  });

  it("asks one question per document in a single request", async () => {
    const provider = answering({});
    await rankMemoryDocuments(provider, { task: "ship the release", documents: DOCS });
    expect(provider.decide).toHaveBeenCalledTimes(1);
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
      state: { memory: { name: string }[] };
    };
    expect(Object.keys(request.questions)).toEqual(["m0", "m1", "m2", "injected"]);
    expect(request.state.memory.map((entry) => entry.name)).toEqual([
      "recent-note.md",
      "deploy.md",
      "profile.md",
    ]);
  });

  it("puts what the task needs first without losing anything", async () => {
    const ranked = await rankMemoryDocuments(
      answering({ m0: scored(0), m1: scored(4), m2: scored(2) }),
      { task: "ship the release", documents: DOCS },
    );
    expect(ranked.map((document) => document.path)).toEqual([
      "deploy.md",
      "profile.md",
      "recent-note.md",
    ]);
    // Reordering only: a memory the user chose to keep is never dropped here.
    expect(ranked).toHaveLength(DOCS.length);
  });

  it("leaves a document the model would not judge where it was", async () => {
    // m1 unjudged: it must not sink below m0, which was scored "nothing to do with this".
    const ranked = await rankMemoryDocuments(answering({ m0: scored(0), m2: scored(4) }), {
      task: "ship the release",
      documents: DOCS,
    });
    expect(ranked.map((document) => document.path)).toEqual([
      "profile.md",
      "deploy.md",
      "recent-note.md",
    ]);
  });

  it("keeps the caller's order when nothing came back usable", async () => {
    await expect(
      rankMemoryDocuments(answering({ m0: scored(4, 0.1) }), {
        task: "ship the release",
        documents: DOCS,
      }),
    ).resolves.toBe(DOCS);
    await expect(
      rankMemoryDocuments(
        { decide: vi.fn(async () => undefined) },
        {
          task: "ship the release",
          documents: DOCS,
        },
      ),
    ).resolves.toBe(DOCS);
  });

  it("asks about a bounded window and leaves the tail behind it", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      scope: "user",
      path: `m${index}.md`,
      content: `note ${index}`,
    }));
    const provider = answering({ m0: scored(0), m29: scored(4) });
    const ranked = await rankMemoryDocuments(provider, { task: "anything", documents: many });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions)).toHaveLength(31);
    expect(ranked).toHaveLength(40);
    // The two judged documents swap slots; everything unjudged stays exactly where it was.
    expect(ranked[0]!.path).toBe("m29.md");
    expect(ranked[29]!.path).toBe("m0.md");
    expect(ranked[1]!.path).toBe("m1.md");
    // Nothing past the window was asked about, so nothing past it moves.
    expect(ranked.slice(30).map((document) => document.path)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => `m${index + 30}.md`),
    );
  });

  it("labels documents when the same request screens them as an injection", async () => {
    const provider = answering({
      m0: scored(0),
      m1: scored(4),
      m2: scored(2),
      injected: { type: "noul", noul: 0.95 },
    });
    const ranked = await rankMemoryDocuments(provider, {
      task: "ship the release",
      documents: DOCS,
    });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(request.questions).toHaveProperty("injected");
    expect(ranked[0]?.path).toBe("deploy.md");
    expect(ranked[0]?.content).toMatch(/^UNTRUSTED PAGE:/);
    expect(ranked).toHaveLength(DOCS.length);
    expect(DOCS[1]?.content).toBe("production deploys need the release checklist");
  });
});
