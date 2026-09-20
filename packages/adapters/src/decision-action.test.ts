import { describe, expect, it, vi } from "vitest";
import {
  closedFollowUpUrls,
  computerActUsesCoordinates,
  decideNextAction,
  extractResultUrls,
  isBrowserFocusedWindow,
  shouldPursueAfterObserve,
  shouldWriteFirstTurn,
} from "./decision-action.js";
import type { DecisionProvider } from "./jev-decisions.js";

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

describe("writer-first turn", () => {
  it("writes when start already chose answer, search already answered, or pursue finished", () => {
    expect(shouldWriteFirstTurn({ start: { first: "answer" } })).toBe(true);
    expect(
      shouldWriteFirstTurn({
        start: { first: "search" },
        prefetch: { kind: "search", query: "q", results: [], answered: true },
      }),
    ).toBe(true);
    expect(shouldWriteFirstTurn({ start: { first: "browse" }, pursued: { status: "done" } })).toBe(
      true,
    );
  });

  it("keeps tools when files are attached or the work is not finished", () => {
    expect(shouldWriteFirstTurn({ start: { first: "answer" }, hasFileAttachments: true })).toBe(
      false,
    );
    expect(
      shouldWriteFirstTurn({
        start: { first: "search" },
        prefetch: { kind: "search", query: "q", results: [], answered: false },
      }),
    ).toBe(false);
    expect(
      shouldWriteFirstTurn({ start: { first: "browse" }, pursued: { status: "blocked" } }),
    ).toBe(false);
    expect(shouldWriteFirstTurn({ start: { first: "fetch" } })).toBe(false);
  });
});

describe("observe continues into pursue", () => {
  it("does not click through a look that start already treated as answer, search, or fetch", () => {
    expect(shouldPursueAfterObserve({ first: "answer" })).toBe(false);
    expect(shouldPursueAfterObserve({ first: "search" })).toBe(false);
    expect(shouldPursueAfterObserve({ first: "fetch" })).toBe(false);
  });

  it("pursues the existing goal after an observe on browse, computer, or an unset start", () => {
    expect(shouldPursueAfterObserve({ first: "browse" })).toBe(true);
    expect(shouldPursueAfterObserve({ first: "computer" })).toBe(true);
    expect(shouldPursueAfterObserve({})).toBe(true);
  });
});

describe("browser-focused desktop", () => {
  it("recognizes common browser window titles", () => {
    expect(isBrowserFocusedWindow("Chromium")).toBe(true);
    expect(isBrowserFocusedWindow("Flights - Google Chrome")).toBe(true);
    expect(isBrowserFocusedWindow("Mozilla Firefox")).toBe(true);
    expect(isBrowserFocusedWindow("Notes")).toBe(false);
    expect(isBrowserFocusedWindow(undefined)).toBe(false);
  });

  it("detects coordinate computer actions so a focused browser can refuse them", () => {
    expect(computerActUsesCoordinates({ actions: [{ kind: "click", x: 10, y: 20 }] })).toBe(true);
    expect(computerActUsesCoordinates({ actions: [{ kind: "type", text: "hi" }] })).toBe(false);
    expect(computerActUsesCoordinates({})).toBe(false);
  });
});

describe("closed follow-up URLs", () => {
  it("points at URLs already in the task or the last result", () => {
    expect(extractResultUrls({ results: [{ url: "https://a.test/x" }] })).toEqual([
      "https://a.test/x",
    ]);
    expect(closedFollowUpUrls("see https://task.test/a", { url: "https://result.test/b" })).toEqual(
      ["https://task.test/a", "https://result.test/b"],
    );
  });
});

describe("deciding the next closed action", () => {
  it("asks nothing without a provider or a task", async () => {
    await expect(
      decideNextAction(undefined, { task: "t", lastTool: "web_search", lastResult: "{}" }),
    ).resolves.toBeUndefined();
    await expect(
      decideNextAction(answering({}), { task: "  ", lastTool: "web_search", lastResult: "{}" }),
    ).resolves.toBeUndefined();
  });

  it("asks next and a speculative URL together", async () => {
    const provider = answering({});
    await decideNextAction(provider, {
      task: "weather in paris",
      lastTool: "web_search",
      lastResult: "hits",
      urls: ["https://a.test/x"],
      canPursue: true,
    });
    const request = (provider.decide as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(request.questions)).toEqual(["next", "fetch_url"]);
  });

  it("returns only closed actions the caller can actually run", async () => {
    await expect(
      decideNextAction(answering({ next: { type: "choice", choice: "answer", confidence: 0.9 } }), {
        task: "weather in paris",
        lastTool: "web_search",
        lastResult: "hits",
      }),
    ).resolves.toEqual({ kind: "write" });

    await expect(
      decideNextAction(answering({ next: { type: "choice", choice: "pursue", confidence: 0.9 } }), {
        task: "click Search",
        lastTool: "browser_observe",
        lastResult: "page",
        canPursue: true,
      }),
    ).resolves.toEqual({ kind: "pursue" });

    await expect(
      decideNextAction(
        answering({
          next: { type: "choice", choice: "fetch", confidence: 0.9 },
          fetch_url: { type: "choice", choice: "https://a.test/x", confidence: 0.9 },
        }),
        {
          task: "Read https://a.test/x",
          lastTool: "web_search",
          lastResult: "hits",
          urls: ["https://a.test/x"],
        },
      ),
    ).resolves.toEqual({ kind: "fetch", url: "https://a.test/x" });

    await expect(
      decideNextAction(answering({ next: { type: "choice", choice: "search", confidence: 0.9 } }), {
        task: "weather in paris",
        lastTool: "browser_observe",
        lastResult: "page",
      }),
    ).resolves.toEqual({ kind: "search", query: "weather in paris" });
  });

  it("does not invent a search after a search, or a URL that was never listed", async () => {
    const provider = answering({
      next: { type: "choice", choice: "search", confidence: 0.99 },
    });
    await expect(
      decideNextAction(provider, {
        task: "weather in paris",
        lastTool: "web_search",
        lastResult: "hits",
      }),
    ).resolves.toBeUndefined();

    await expect(
      decideNextAction(
        answering({
          next: { type: "choice", choice: "fetch", confidence: 0.99 },
          fetch_url: { type: "choice", choice: "none_of_these", confidence: 0.99 },
        }),
        {
          task: "compare two pages",
          lastTool: "web_search",
          lastResult: "hits",
          urls: ["https://a.test/x", "https://b.test/y"],
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("falls back when the model hedges", async () => {
    await expect(
      decideNextAction(
        answering({ next: { type: "choice", choice: "none_of_these", confidence: 0.99 } }),
        { task: "t", lastTool: "web_search", lastResult: "hits" },
      ),
    ).resolves.toBeUndefined();
  });
});
