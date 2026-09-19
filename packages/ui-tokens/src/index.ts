export const APPEARANCE_PREFERENCES = ["system", "light", "dark"] as const;

export type AppearancePreference = (typeof APPEARANCE_PREFERENCES)[number];

export type ResolvedAppearance = "light" | "dark";

export const UI_APPEARANCE_STORAGE_KEY = "cadre.uiAppearance";

/**
 * Semantic palette shared by web, Electron, and Expo. Names follow the shadcn
 * convention so the same slot means the same thing on every surface: a `border`
 * is always a border and never a fill.
 */
export type ColorTokens = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  link: string;
  /**
   * The composer's resting fill. Measured off the reference at `#f3f3f3` on
   * a white pane: the composer is a FILLED pill, not a bordered box. Drawing
   * it as a border on the same fill as the pane is what put a hard, light
   * arc on its corners — a 1px line spread over two pixels by the radius,
   * which reads as a double-weight stroke and is the first thing the eye
   * lands on in an otherwise quiet screen.
   */
  composer: string;
  success: string;
  warning: string;
  overlay: string;
  scrollbar: string;
  scrollbarHover: string;
};

export const darkTokens = {
  background: "#1C1C1C",
  foreground: "#F4F4F4",
  card: "#242424",
  cardForeground: "#F4F4F4",
  popover: "#242424",
  popoverForeground: "#F4F4F4",
  primary: "#F2F2F2",
  primaryForeground: "#1C1C1C",
  secondary: "#303030",
  secondaryForeground: "#F4F4F4",
  muted: "#303030",
  mutedForeground: "#A8A8A8",
  accent: "#383838",
  accentForeground: "#F4F4F4",
  destructive: "#EF4444",
  destructiveForeground: "#FFFFFF",
  border: "#3B3B3B",
  input: "#444444",
  ring: "#B8B8B8",
  sidebar: "#171717",
  sidebarForeground: "#F4F4F4",
  sidebarBorder: "#333333",
  sidebarAccent: "#242424",
  sidebarAccentForeground: "#F4F4F4",
  link: "#DEDEDE",
  composer: "#242424",
  success: "#4ECB71",
  warning: "#E9C46A",
  overlay: "rgba(0, 0, 0, 0.62)",
  scrollbar: "#444444",
  scrollbarHover: "#686868",
} as const satisfies ColorTokens;

export const lightTokens = {
  background: "#FCFBF8",
  foreground: "#24222A",
  card: "#FFFFFF",
  cardForeground: "#1A1A1A",
  popover: "#FFFFFF",
  popoverForeground: "#1A1A1A",
  primary: "#514074",
  primaryForeground: "#FFFFFF",
  secondary: "#F0F0F0",
  secondaryForeground: "#1A1A1A",
  muted: "#F0F0F0",
  mutedForeground: "#6C6C70",
  accent: "#EAEAEA",
  accentForeground: "#1A1A1A",
  destructive: "#DC2626",
  destructiveForeground: "#FFFFFF",
  border: "#E2DDE7",
  input: "#DAD4E2",
  ring: "#77658F",
  sidebar: "#F0EDE7",
  sidebarForeground: "#1A1A1A",
  sidebarBorder: "#E8E8E8",
  sidebarAccent: "#FFFFFF",
  sidebarAccentForeground: "#1A1A1A",
  link: "#2563EB",
  composer: "#F3F3F3",
  success: "#228B3B",
  warning: "#B7791F",
  overlay: "rgba(20, 20, 22, 0.45)",
  scrollbar: "#C8C8C8",
  scrollbarHover: "#A8A8A8",
} as const satisfies ColorTokens;

/** Dark palette. Prefer `tokensForAppearance` when theme-aware. */
export const tokens = darkTokens;

export const RADIUS = "0.75rem";

export const botColors = [
  "#3EC5A8",
  "#F5A03C",
  "#6A6BF5",
  "#9B5CF6",
  "#3B82F6",
  "#F2622A",
  "#D9508A",
] as const;

export function isAppearancePreference(
  value: string | null | undefined,
): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(
  raw: string | null | undefined,
): AppearancePreference {
  return isAppearancePreference(raw) ? raw : "dark";
}

export type ResolveAppearancePreferenceOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function resolveAppearancePreference(
  options: ResolveAppearancePreferenceOptions = {},
): AppearancePreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStoredAppearance(options.storage ?? getLocalStorage());
  return normalizeAppearancePreference(stored);
}

export function persistAppearancePreference(
  preference: AppearancePreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(UI_APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Ignore quota / private-mode failures; in-memory preference still applies.
  }
}

export function resolveAppearance(
  preference: AppearancePreference,
  system: ResolvedAppearance = "dark",
): ResolvedAppearance {
  if (preference === "system") return system;
  return preference;
}

export function tokensForAppearance(appearance: ResolvedAppearance): ColorTokens {
  return appearance === "light" ? lightTokens : darkTokens;
}

function readStoredAppearance(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `cardForeground` -> `--card-foreground` */
export function cssVariableName(token: keyof ColorTokens): string {
  return `--${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function renderBlock(selector: string, colorScheme: ResolvedAppearance, palette: ColorTokens) {
  const lines = (Object.keys(palette) as (keyof ColorTokens)[]).map(
    (token) => `  ${cssVariableName(token)}: ${palette[token].toLowerCase()};`,
  );
  return `${selector} {\n  color-scheme: ${colorScheme};\n${lines.join("\n")}\n  --radius: ${RADIUS};\n}`;
}

/** The CSS in `tokens.css`. Generated from the TS palette so both stay in sync. */
export function renderTokensCss(): string {
  return `${[
    "/* Generated by `pnpm --filter @cadre/ui-tokens generate`. Edit src/index.ts instead. */",
    renderBlock(':root,\n[data-theme="dark"]', "dark", darkTokens),
    renderBlock('[data-theme="light"]', "light", lightTokens),
  ].join("\n\n")}\n`;
}
