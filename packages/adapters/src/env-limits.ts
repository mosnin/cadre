/**
 * A token limit read from the environment.
 *
 * Throwing rather than falling back is deliberate: a silent default would accept
 * a negative window and swallow a typo as the default.
 */
export function tokenLimit(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}
