import type { ModelCatalogEntry } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  featuredModelProviders,
  modelCatalogEntryMatchesQuery,
  selectedProviderOutsideSearchResults,
} from "./model-providers.js";

function provider(provider: string): ModelCatalogEntry {
  return {
    provider,
    providerName: provider,
    id: `${provider}-model`,
    label: `${provider} model`,
    billing: "",
  };
}

describe("featuredModelProviders", () => {
  it("shows popular providers in a stable order", () => {
    const providers = [
      provider("azure"),
      provider("vercel-ai-gateway"),
      provider("google"),
      provider("openai"),
      provider("anthropic"),
      provider("openai-codex"),
      provider("openrouter"),
    ];

    expect(featuredModelProviders(providers, "openrouter").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "openai-codex",
      "anthropic",
      "openai",
      "google",
      "vercel-ai-gateway",
    ]);
  });

  it("fills missing popular slots from the catalog", () => {
    const providers = [
      provider("azure"),
      provider("openrouter"),
      provider("bedrock"),
      provider("anthropic"),
    ];

    expect(featuredModelProviders(providers, "openrouter").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "anthropic",
      "azure",
      "bedrock",
    ]);
  });

  it("keeps a non-featured selected provider visible", () => {
    const providers = [
      provider("openrouter"),
      provider("openai-codex"),
      provider("anthropic"),
      provider("openai"),
      provider("google"),
      provider("vercel-ai-gateway"),
      provider("local"),
    ];

    expect(featuredModelProviders(providers, "local").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "openai-codex",
      "anthropic",
      "openai",
      "google",
      "local",
    ]);
  });
});

describe("selectedProviderOutsideSearchResults", () => {
  it("returns the active provider separately from unrelated search results", () => {
    const providers = [provider("openrouter"), provider("anthropic"), provider("bedrock")];

    expect(
      selectedProviderOutsideSearchResults(providers.slice(1), providers, "openrouter"),
    ).toMatchObject({ provider: "openrouter" });
  });

  it("returns nothing when the active provider matches the search", () => {
    const providers = [provider("openrouter"), provider("anthropic")];

    expect(
      selectedProviderOutsideSearchResults(providers, providers, "openrouter"),
    ).toBeUndefined();
  });
});

describe("modelCatalogEntryMatchesQuery", () => {
  const codex = {
    ...provider("openai-codex"),
    providerName: "OpenAI Codex",
    id: "codex-model",
    label: "Codex model",
    authHint: "ChatGPT Plus/Pro",
    oauthLabel: "Sign in with ChatGPT Plus/Pro",
    billing: "Uses your subscription",
  };

  it("finds subscription providers by the account name instead of requiring the internal id", () => {
    expect(modelCatalogEntryMatchesQuery(codex, "  ChatGPT  ")).toBe(true);
    expect(modelCatalogEntryMatchesQuery(provider("openai"), "ChatGPT")).toBe(false);
  });

  it("matches hints and keeps model/provider search working", () => {
    for (const query of ["Plus/Pro", "sign in", "subscription", "openai", "codex-model", ""]) {
      expect(modelCatalogEntryMatchesQuery(codex, query)).toBe(true);
    }
    expect(modelCatalogEntryMatchesQuery(codex, "unrelated-provider")).toBe(false);
  });
});
