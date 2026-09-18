import type { AdapterContext } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { MarkdownMemoryStore } from "./index.js";

const context: AdapterContext = {
  operationId: "read-memory",
  traceId: "read-memory",
  spaceId: "workspace-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

describe("memory store contract shape", () => {
  it("declares markdown portability", () => {
    const store = new MarkdownMemoryStore({} as never);
    expect(store.describe().capabilities.markdownPortable).toBe(true);
  });

  it("reads the most recently updated documents first", async () => {
    const updatedAt = new Date("2026-08-16T10:00:00.000Z");
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { id: "memory-1", path: "facts.md", content: "A fact", revision: 3, updatedAt },
      ]);
    const store = new MarkdownMemoryStore({ memoryDocument: { findMany } } as never);

    await expect(store.read({ scope: "bot", botId: "bot-1" }, context)).resolves.toEqual({
      documents: [
        {
          id: "memory-1",
          path: "facts.md",
          content: "A fact",
          revision: 3,
          updatedAt: updatedAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        spaceId: "workspace-1",
        userId: "user-1",
        scope: "bot",
        botId: "bot-1",
      },
      orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    });
  });
});

describe("search scoring", () => {
  it("ranks by how well a document answers the query rather than giving every hit the same score", async () => {
    const documents = [
      {
        id: "1",
        path: "notes.md",
        content: "deploy",
        revision: 1,
        updatedAt: new Date(),
        spaceId: "s",
        userId: "u",
        scope: "user",
        botId: null,
      },
      {
        id: "2",
        path: "deploy.md",
        content: "deploy deploy deploy deploy deploy",
        revision: 1,
        updatedAt: new Date(),
        spaceId: "s",
        userId: "u",
        scope: "user",
        botId: null,
      },
      {
        id: "3",
        path: "other.md",
        content: "nothing here",
        revision: 1,
        updatedAt: new Date(),
        spaceId: "s",
        userId: "u",
        scope: "user",
        botId: null,
      },
    ];
    const store = new MarkdownMemoryStore({
      memoryDocument: { findMany: async () => documents },
    } as never);
    const results = await store.search({ query: "deploy", scope: "all" }, context);
    expect(results.map((result) => result.path)).toEqual(["deploy.md", "notes.md"]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(new Set(results.map((result) => result.score)).size).toBe(2);
  });
});
