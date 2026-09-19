import type { AdapterContext, WebFetchProvider, WebSearchProvider } from "@cadre/adapter-kit";
import { escapePromptData } from "@cadre/core";
import { markUntrustedFetchText, screenUntrustedText } from "./decision-guardrails.js";
import { rankWebSearchHits } from "./decision-search.js";
import { type RunStartDecision, searchQueryForStart } from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";
import { clampMaxChars, clampMaxResults } from "./web-limits.js";

export async function webSearchFromTool(
  search: WebSearchProvider,
  context: AdapterContext,
  args: Record<string, unknown>,
  /** When configured, reorders results by how well they answer the question actually asked. */
  decisions?: { provider?: DecisionProvider; sessionId?: string },
) {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query is required" };
  try {
    const results = await search.search(
      {
        query,
        maxResults: clampMaxResults(args.maxResults),
        signal: context.signal,
      },
      context,
    );
    const ranked = await rankWebSearchHits(decisions?.provider, query, results, {
      sessionId: decisions?.sessionId,
      signal: context.signal,
    });
    return {
      results: ranked.hits,
      ...(ranked.answered
        ? {
            answered: true,
            note: "These results already answer the question. Do not fetch more pages unless you need a specific source.",
          }
        : {}),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function webFetchFromTool(
  fetchProvider: WebFetchProvider,
  context: AdapterContext,
  args: Record<string, unknown>,
  decisions?: { provider?: DecisionProvider; sessionId?: string },
) {
  const url = String(args.url ?? "").trim();
  if (!url) return { error: "url is required" };
  try {
    const result = await fetchProvider.fetch(
      {
        url,
        maxChars: clampMaxChars(args.maxChars),
        signal: context.signal,
      },
      context,
    );
    const screen = await screenUntrustedText(decisions?.provider, {
      source: result.url,
      text: result.text,
      sessionId: decisions?.sessionId,
      signal: context.signal,
    });
    if (!screen.injected) return result;
    return { ...result, text: markUntrustedFetchText(result.text), injected: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export type PrefetchedStart =
  | { kind: "fetch"; url: string; text: string }
  | {
      kind: "search";
      query: string;
      results: Array<{ title: string; url: string; snippet: string }>;
      answered: boolean;
    };

/**
 * First tool the start decision already committed to, run while the computer
 * provisions so the model does not spend a generation opening the same page
 * or inventing a search.
 */
export async function prefetchRunStart(
  web: WebSearchProvider & WebFetchProvider,
  context: AdapterContext,
  start: RunStartDecision,
  task: string,
  decisions?: { provider?: DecisionProvider; sessionId?: string },
): Promise<PrefetchedStart | undefined> {
  if (start.first === "fetch" && start.fetchUrl) {
    const result = await webFetchFromTool(web, context, { url: start.fetchUrl }, decisions);
    if ("error" in result || typeof result.text !== "string" || !result.text.trim()) {
      return undefined;
    }
    const url = typeof result.url === "string" && result.url.trim() ? result.url : start.fetchUrl;
    return { kind: "fetch", url, text: result.text };
  }
  if (start.first === "search") {
    const query = searchQueryForStart(task);
    if (!query) return undefined;
    const result = await webSearchFromTool(web, context, { query }, decisions);
    if ("error" in result || !Array.isArray(result.results) || result.results.length === 0) {
      return undefined;
    }
    return {
      kind: "search",
      query,
      results: result.results.map((hit) => ({
        title: String(hit.title ?? ""),
        url: String(hit.url ?? ""),
        snippet: String(hit.snippet ?? ""),
      })),
      answered: result.answered === true,
    };
  }
  return undefined;
}

export function formatPrefetchedStartPrompt(prefetch: PrefetchedStart): string {
  if (prefetch.kind === "fetch") {
    return `<fetched_page url="${escapePromptData(prefetch.url)}">\n${escapePromptData(prefetch.text)}\n</fetched_page>\nThe page above was already fetched. Use it. Do not fetch it again unless you need a different page.`;
  }
  const rows = prefetch.results
    .map(
      (hit) =>
        `- ${escapePromptData(hit.title)} (${escapePromptData(hit.url)}): ${escapePromptData(hit.snippet)}`,
    )
    .join("\n");
  const closer = prefetch.answered
    ? "These results already answer the question. Do not fetch more pages unless you need a specific source."
    : "Search results above were already retrieved. Do not search again unless the query must change.";
  return `<search_results query="${escapePromptData(prefetch.query)}">\n${rows}\n</search_results>\n${closer}`;
}
