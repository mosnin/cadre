import { describe, expect, it, vi } from "vitest";
import { normalizeImportedOAuthCredential } from "./model-oauth-import.js";
import { listPiCatalog } from "./pi-models.js";
import { serializeModelSecret } from "./pi-oauth.js";

const now = 1_000_000_000_000;
const fresh = now + 60 * 60 * 1000;

describe("normalizeImportedOAuthCredential", () => {
  it("normalizes a valid Claude login into the stored Pi shape without refreshing", async () => {
    const refresh = vi.fn();
    const result = await normalizeImportedOAuthCredential(
      {
        provider: "anthropic",
        source: "claude-cli",
        credential: { access: "sk-ant-oat-a", refresh: "sk-ant-ort-r", expires: fresh },
      },
      { oauth: { refresh }, now },
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(result.label).toBe("Claude Pro/Max (from Claude CLI)");
    expect(result.credential).toEqual({
      type: "oauth",
      access: "sk-ant-oat-a",
      refresh: "sk-ant-ort-r",
      expires: fresh,
    });
    expect(
      JSON.parse(serializeModelSecret({ kind: "oauth", credential: result.credential })),
    ).toMatchObject({
      type: "oauth",
    });
  });

  it("keeps accountId for Codex", async () => {
    const result = await normalizeImportedOAuthCredential(
      {
        provider: "openai-codex",
        source: "codex-cli",
        credential: { access: "a", refresh: "r", expires: fresh, accountId: "acct-1" },
      },
      { oauth: { refresh: vi.fn() }, now },
    );
    expect(result.credential.accountId).toBe("acct-1");
    expect(result.label).toBe("ChatGPT Plus/Pro (from Codex CLI)");
  });

  it("refreshes expired and near-expiry logins", async () => {
    for (const expires of [now - 1000, now + 60_000]) {
      const refresh = vi.fn().mockResolvedValue({
        type: "oauth",
        access: "new-a",
        refresh: "new-r",
        expires: fresh,
      });
      const result = await normalizeImportedOAuthCredential(
        { provider: "anthropic", credential: { access: "a", refresh: "r", expires } },
        { oauth: { refresh }, now },
      );
      expect(refresh).toHaveBeenCalledOnce();
      expect(result.credential).toMatchObject({
        access: "new-a",
        refresh: "new-r",
        expires: fresh,
      });
      expect(result.label).toBe("Claude Pro/Max");
    }
  });

  it("refreshes Codex when accountId is missing so it is derived from the token", async () => {
    const refresh = vi.fn().mockResolvedValue({
      type: "oauth",
      access: "n",
      refresh: "n2",
      expires: fresh,
      accountId: "derived",
    });
    const result = await normalizeImportedOAuthCredential(
      { provider: "openai-codex", credential: { access: "a", refresh: "r", expires: fresh } },
      { oauth: { refresh }, now },
    );
    expect(result.credential.accountId).toBe("derived");
  });

  it("rejects unknown providers and mismatched sources", async () => {
    await expect(
      normalizeImportedOAuthCredential({
        provider: "xai" as never,
        credential: { access: "a", refresh: "r", expires: fresh },
      }),
    ).rejects.toThrow("Only Claude Pro/Max and ChatGPT Plus/Pro");
    await expect(
      normalizeImportedOAuthCredential({
        provider: "anthropic",
        source: "codex-cli",
        credential: { access: "a", refresh: "r", expires: fresh },
      }),
    ).rejects.toThrow("does not match");
  });

  it("reports an expired login without leaking tokens when refresh fails", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("boom secret-access secret-refresh"));
    const err = await normalizeImportedOAuthCredential(
      {
        provider: "anthropic",
        credential: { access: "secret-access", refresh: "secret-refresh", expires: now - 1 },
      },
      { oauth: { refresh }, now },
    ).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "That login has expired. Sign in to Claude again in the CLI, then try again.",
    );
    expect((err as Error).message).not.toContain("secret");
    const codex = await normalizeImportedOAuthCredential(
      {
        provider: "openai-codex",
        credential: { access: "a", refresh: "r", expires: now - 1, accountId: "x" },
      },
      { oauth: { refresh }, now },
    ).catch((e: Error) => e);
    expect((codex as Error).message).toContain("Sign in to Codex again");
  });
});

describe("OpenRouter catalog", () => {
  it("lists OpenRouter as a connectable API-key provider with a friendly name", () => {
    const entry = listPiCatalog().find((e) => e.provider === "openrouter");
    expect(entry?.providerName).toBe("OpenRouter");
    expect(["api-key", "both"]).toContain(entry?.auth);
  });
});
