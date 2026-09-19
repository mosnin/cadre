import type { AdapterContext } from "@cadre/adapter-kit";
import { describe, expect, it } from "vitest";
import { FakeWebProvider } from "./fake-web.js";
import {
  extractReadableText,
  KeylessHttpWebProvider,
  parseDuckDuckGoResults,
} from "./keyless-http-web.js";
import { clampMaxChars, clampMaxResults } from "./web-limits.js";
import { createWebProvider, resolveWebProviderKind } from "./web-provider-factory.js";
import {
  formatPrefetchedStartPrompt,
  prefetchRunStart,
  webFetchFromTool,
  webSearchFromTool,
} from "./web-tools.js";

const ctx: AdapterContext = {
  operationId: "1",
  traceId: "1",
  spaceId: "w",
  userId: "u",
  signal: new AbortController().signal,
};

const publicResolver = async () => [{ address: "203.0.113.10", family: 4 as const }];

describe("web provider factory", () => {
  it("defaults to keyless-http", () => {
    expect(resolveWebProviderKind({})).toBe("keyless-http");
    expect(createWebProvider().describe().id).toBe("keyless-http");
    expect(createWebProvider("fake").describe().id).toBe("fake");
  });
});

describe("keyless HTTP web provider", () => {
  it("searches via the HTML backend without a vendor API key", async () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Fa">Alpha</a>
        <a class="result__snippet">Snippet A</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.test/b">Beta</a>
        <div class="result__snippet">Snippet B</div>
      </div>
    `;
    const fetchMock: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const provider = new KeylessHttpWebProvider({
      fetch: fetchMock,
      resolveHostname: publicResolver,
    });
    const results = await provider.search({ query: "alpha", maxResults: 5 }, ctx);
    expect(results).toEqual([
      { title: "Alpha", url: "https://example.test/a", snippet: "Snippet A" },
      { title: "Beta", url: "https://example.test/b", snippet: "Snippet B" },
    ]);
  });

  it("fetches readable page text with truncation", async () => {
    const long = "word ".repeat(100);
    const html = `<html><head><title>Doc</title></head><body><article><p>${long}</p></article></body></html>`;
    const fetchMock: typeof fetch = async () =>
      new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    const provider = new KeylessHttpWebProvider({
      fetch: fetchMock,
      resolveHostname: publicResolver,
    });
    const result = await provider.fetch({ url: "https://example.test/doc", maxChars: 120 }, ctx);
    expect(result.title).toBeTruthy();
    expect(result.url).toBe("https://example.test/doc");
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith("[Content truncated]")).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(120 + "\n\n[Content truncated]".length);
  });

  it("falls back to HTML strip when Readability finds nothing", () => {
    const extracted = extractReadableText(
      "<html><title>Plain</title><body><div>just text here</div></body></html>",
      "https://example.test/",
    );
    expect(extracted.title).toBe("Plain");
    expect(extracted.text).toContain("just text here");
  });

  it("parses HTML search results with a cap", () => {
    const html = Array.from({ length: 12 }, (_, i) => {
      return `<div class="result"><a class="result__a" href="https://example.test/${i}">T${i}</a><div class="result__snippet">S${i}</div></div>`;
    }).join("");
    expect(parseDuckDuckGoResults(html, 3)).toHaveLength(3);
  });
});

describe("web tool apply with fake provider", () => {
  it("returns injected search and fetch results", async () => {
    const fake = new FakeWebProvider();
    fake.searchHits = [
      { title: "One", url: "https://example.test/1", snippet: "s1" },
      { title: "Two", url: "https://example.test/2", snippet: "s2" },
    ];
    fake.fetchResult = {
      url: "https://example.test/1",
      title: "One",
      text: "Body text",
      truncated: false,
    };

    await expect(webSearchFromTool(fake, ctx, { query: "q", maxResults: 1 })).resolves.toEqual({
      results: [{ title: "One", url: "https://example.test/1", snippet: "s1" }],
    });
    expect(fake.lastSearch?.query).toBe("q");

    await expect(
      webFetchFromTool(fake, ctx, { url: "https://example.test/1", maxChars: 100 }),
    ).resolves.toEqual({
      url: "https://example.test/1",
      title: "One",
      text: "Body text",
      truncated: false,
    });
  });

  it("surfaces provider errors as tool errors", async () => {
    const fake = new FakeWebProvider();
    fake.searchError = new Error("boom");
    await expect(webSearchFromTool(fake, ctx, { query: "q" })).resolves.toEqual({
      error: "boom",
    });
  });
});

describe("web tool clamps", () => {
  it("clamps maxResults and maxChars", () => {
    expect(clampMaxResults(undefined)).toBe(5);
    expect(clampMaxResults(100)).toBe(10);
    expect(clampMaxResults(0)).toBe(1);
    expect(clampMaxChars(undefined)).toBe(8_000);
    expect(clampMaxChars(10)).toBe(100);
    expect(clampMaxChars(999_999)).toBe(50_000);
  });
});

describe("prefetching the first start action", () => {
  it("fetches the URL the start decision already picked", async () => {
    const fake = new FakeWebProvider();
    fake.fetchResult = {
      url: "https://docs.example/a",
      title: "A",
      text: "Auth module",
      truncated: false,
    };
    const prefetched = await prefetchRunStart(
      fake,
      ctx,
      { first: "fetch", fetchUrl: "https://docs.example/a" },
      "Read https://docs.example/a",
    );
    expect(prefetched).toEqual({
      kind: "fetch",
      url: "https://docs.example/a",
      text: "Auth module",
    });
    expect(formatPrefetchedStartPrompt(prefetched!)).toContain("already fetched");
  });

  it("does not need connectors — a boot context with empty plugins is enough", async () => {
    const fake = new FakeWebProvider();
    fake.searchHits = [{ title: "Paris", url: "https://w.test", snippet: "12C" }];
    const boot: AdapterContext = {
      ...ctx,
      connectedConnections: [],
      connectedProviders: [],
    };
    await expect(
      prefetchRunStart(fake, boot, { first: "search" }, "weather in paris"),
    ).resolves.toMatchObject({ kind: "search", query: "weather in paris" });
  });

  it("searches with the user's own wording when that is already a query", async () => {
    const fake = new FakeWebProvider();
    fake.searchHits = [{ title: "Paris", url: "https://w.test", snippet: "12C" }];
    const prefetched = await prefetchRunStart(fake, ctx, { first: "search" }, "weather in paris");
    expect(prefetched).toMatchObject({ kind: "search", query: "weather in paris" });
    expect(fake.lastSearch?.query).toBe("weather in paris");
    expect(formatPrefetchedStartPrompt(prefetched!)).toContain("already retrieved");
  });

  it("does not invent a query from a long brief", async () => {
    const fake = new FakeWebProvider();
    await expect(
      prefetchRunStart(fake, ctx, { first: "search" }, "x".repeat(401)),
    ).resolves.toBeUndefined();
    expect(fake.lastSearch).toBeUndefined();
  });

  it("returns nothing when fetch or search fails so the run can still generate", async () => {
    const fake = new FakeWebProvider();
    fake.fetchError = new Error("timeout");
    await expect(
      prefetchRunStart(
        fake,
        ctx,
        { first: "fetch", fetchUrl: "https://docs.example/a" },
        "Read https://docs.example/a",
      ),
    ).resolves.toBeUndefined();

    fake.searchError = new Error("down");
    await expect(
      prefetchRunStart(fake, ctx, { first: "search" }, "weather in paris"),
    ).resolves.toBeUndefined();
  });
});
