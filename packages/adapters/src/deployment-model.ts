/**
 * The deployment-wide model default: which provider a run falls back to when no user
 * credential applies, and the key for that provider.
 *
 * Vendor env names and model ids live here, in the adapter layer, not in core.
 */

/** OpenRouter generation default: Qwen for writing, Jev for the decisions around it. */
export const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3-235b-a22b";

export function resolveDeploymentModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PI_DEFAULT_PROVIDER?.trim() || "openrouter";
  // A row per provider that ships a deployment key. A third one adds a row here, not a
  // branch at each call site — and an unknown provider gets no key rather than another
  // vendor's, which a ternary on one provider would not give.
  const keys: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
  };
  const models: Record<string, string> = {
    openrouter: DEFAULT_OPENROUTER_MODEL,
    anthropic: "claude-sonnet-5",
  };
  return {
    provider,
    model: env.PI_DEFAULT_MODEL?.trim() || models[provider] || models.openrouter!,
    key: keys[provider],
  };
}
