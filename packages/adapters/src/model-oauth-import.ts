import type { ModelOAuthImportInput } from "@cadre/contracts";
import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import {
  ANTHROPIC_OAUTH_PROVIDER,
  CHATGPT_OAUTH_PROVIDER,
  loadProviderOAuth,
  MIN_OAUTH_VALIDITY_MS,
} from "./pi-oauth.js";

const IMPORTABLE: Record<string, { defaultLabel: string; sources: Record<string, string> }> = {
  [ANTHROPIC_OAUTH_PROVIDER]: {
    defaultLabel: "Claude Pro/Max",
    sources: { "claude-cli": "Claude CLI" },
  },
  [CHATGPT_OAUTH_PROVIDER]: {
    defaultLabel: "ChatGPT Plus/Pro",
    sources: { "codex-cli": "Codex CLI" },
  },
};

const EXPIRED_MESSAGE: Record<string, string> = {
  [ANTHROPIC_OAUTH_PROVIDER]:
    "That login has expired. Sign in to Claude again in the CLI, then try again.",
  [CHATGPT_OAUTH_PROVIDER]:
    "That login has expired. Sign in to Codex again in the CLI, then try again.",
};

export type ImportedOAuth = { credential: OAuthCredential; label: string };

/**
 * Turns a login read from a local CLI into the credential Pi expects. Expired or
 * nearly expired logins are refreshed first. Errors never include token material.
 */
export async function normalizeImportedOAuthCredential(
  input: Pick<ModelOAuthImportInput, "provider" | "credential" | "source" | "label">,
  opts: { oauth?: Pick<OAuthAuth, "refresh">; now?: number; signal?: AbortSignal } = {},
): Promise<ImportedOAuth> {
  const meta = IMPORTABLE[input.provider];
  if (!meta) {
    throw new Error("Only Claude Pro/Max and ChatGPT Plus/Pro logins can be imported.");
  }
  if (input.source && !meta.sources[input.source]) {
    throw new Error("That login does not match the selected provider.");
  }
  const access = input.credential.access.trim();
  const refresh = input.credential.refresh.trim();
  const accountId = input.credential.accountId?.trim();
  if (!access || !refresh || !Number.isFinite(input.credential.expires)) {
    throw new Error("That login is incomplete. Sign in again in the CLI, then try again.");
  }
  let credential: OAuthCredential = {
    type: "oauth",
    access,
    refresh,
    expires: input.credential.expires,
    ...(accountId ? { accountId } : {}),
  };
  const now = opts.now ?? Date.now();
  // Codex derives accountId from the token on refresh, so refresh when it is missing.
  const needsAccountId = input.provider === CHATGPT_OAUTH_PROVIDER && !accountId;
  if (credential.expires - now < MIN_OAUTH_VALIDITY_MS || needsAccountId) {
    const oauth = opts.oauth ?? loadProviderOAuth(input.provider);
    if (!oauth) throw new Error("Subscription sign-in is not available for this provider.");
    let refreshed: OAuthCredential;
    try {
      refreshed = await oauth.refresh(credential, opts.signal ?? new AbortController().signal);
    } catch {
      throw new Error(EXPIRED_MESSAGE[input.provider]);
    }
    if (!refreshed?.access || !refreshed.refresh || !Number.isFinite(refreshed.expires)) {
      throw new Error(EXPIRED_MESSAGE[input.provider]);
    }
    credential = { ...refreshed, type: "oauth" };
  }
  const sourceName = input.source ? meta.sources[input.source] : undefined;
  const label =
    input.label?.trim() ||
    (sourceName ? `${meta.defaultLabel} (from ${sourceName})` : meta.defaultLabel);
  return { credential, label };
}
