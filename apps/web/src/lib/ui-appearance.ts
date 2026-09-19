import {
  type AppearancePreference,
  persistAppearancePreference,
  type ResolvedAppearance,
  resolveAppearance,
  resolveAppearancePreference,
  tokensForAppearance,
} from "@cadre/ui-tokens";

export type { AppearancePreference, ResolvedAppearance };

const THEME_COLOR_META = 'meta[name="theme-color"]';

export function readSystemAppearance(
  media: Pick<MediaQueryList, "matches"> | null = typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null,
): ResolvedAppearance {
  return media?.matches ? "light" : "dark";
}

export function applyResolvedAppearance(
  appearance: ResolvedAppearance,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): void {
  if (!root) return;
  root.dataset.theme = appearance;
  // Third-party components read the Tailwind convention — a `dark` class on
  // the documentElement — and cannot be told otherwise without editing them.
  // ElevenLabs' orb is one: it flips its colour ramp on that class, and
  // without it every orb in the dark theme ramped the wrong way and blew out
  // to white. The class carries no styles of our own (`@custom-variant dark`
  // keys on `[data-theme]`), so it costs nothing and it is one place rather
  // than a patch in every vendored file.
  root.classList.toggle("dark", appearance === "dark");
  root.classList.toggle("light", appearance === "light");
  root.style.colorScheme = appearance;
  if (typeof document === "undefined") return;
  const meta = document.querySelector(THEME_COLOR_META);
  if (meta) {
    meta.setAttribute("content", tokensForAppearance(appearance).background);
  }
}

export function applyUiAppearance(
  preference: AppearancePreference = resolveAppearancePreference(),
  system: ResolvedAppearance = readSystemAppearance(),
): ResolvedAppearance {
  const resolved = resolveAppearance(preference, system);
  applyResolvedAppearance(resolved);
  return resolved;
}

export function setUiAppearance(preference: AppearancePreference): ResolvedAppearance {
  persistAppearancePreference(preference);
  return applyUiAppearance(preference);
}

export function getUiAppearancePreference(): AppearancePreference {
  return resolveAppearancePreference();
}

/** Keep `data-theme` in sync when the OS scheme changes and preference is System. */
export function watchSystemAppearance(
  onChange: (system: ResolvedAppearance) => void = () => {
    if (resolveAppearancePreference() === "system") applyUiAppearance("system");
  },
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => onChange(media.matches ? "light" : "dark");
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
