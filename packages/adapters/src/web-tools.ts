import type { AdapterContext, WebFetchProvider, WebSearchProvider } from "@rakazo/adapter-kit";
import { rankWebSearchHits } from "./decision-search.js";
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
    return {
      results: await rankWebSearchHits(decisions?.provider, query, results, {
        sessionId: decisions?.sessionId,
        signal: context.signal,
      }),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function webFetchFromTool(
  fetchProvider: WebFetchProvider,
  context: AdapterContext,
  args: Record<string, unknown>,
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
    return result;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
