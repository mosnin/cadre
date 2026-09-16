import { useSyncExternalStore } from "react";
import { ZH_MESSAGES } from "./locales/zh";
import {
  htmlLangForLocale,
  resolveUiLocale,
  UI_LOCALE_STORAGE_KEY,
  type UiLocale,
} from "./ui-locale";

const catalogs: Partial<Record<UiLocale, Record<string, string>>> = {
  "zh-CN": ZH_MESSAGES,
};

let activeLocale: UiLocale = "en";
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeI18n(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveUiLocale(): UiLocale {
  return activeLocale;
}

export function dateLocaleForUi(locale: UiLocale = activeLocale): string {
  return locale === "en" ? "en-US" : htmlLangForLocale(locale);
}

export function t(message: string, values?: Record<string, string | number>): string {
  const template = catalogs[activeLocale]?.[message] ?? message;
  if (!values) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function useI18n(): { locale: UiLocale; t: typeof t } {
  const locale = useSyncExternalStore(subscribeI18n, getActiveUiLocale, getActiveUiLocale);
  return { locale, t };
}

function readDeviceLanguage(): string | null {
  try {
    const IntlRef = globalThis.Intl;
    return IntlRef?.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

export function activateUiLocale(locale: UiLocale): UiLocale {
  activeLocale = locale;
  emit();
  return locale;
}

async function applyDirection(locale: UiLocale): Promise<void> {
  try {
    // Direction follows the active UI locale only (en / zh-CN → LTR), never the
    // device language. Applying device RTL here would fight this and reload-loop.
    const { applyMobileUiDirection } = await import("./ui-direction");
    applyMobileUiDirection(htmlLangForLocale(locale));
  } catch {
    // Tests and some hosts have no native direction APIs.
  }
}

async function readDeviceLocaleTag(): Promise<string | null> {
  try {
    const localization = await import("expo-localization");
    const tag = localization.getLocales()[0]?.languageTag;
    if (typeof tag === "string" && tag) return tag;
  } catch {
    // Keep Intl fallback.
  }
  return readDeviceLanguage();
}

function envDefaultUiLocale(): string | null {
  return typeof process !== "undefined" &&
    typeof process.env.EXPO_PUBLIC_DEFAULT_UI_LOCALE === "string"
    ? process.env.EXPO_PUBLIC_DEFAULT_UI_LOCALE
    : null;
}

export async function bootstrapI18n(): Promise<UiLocale> {
  let stored: string | null = null;
  try {
    const SecureStore = await import("expo-secure-store");
    stored = await SecureStore.getItemAsync(UI_LOCALE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const locale = resolveUiLocale({
    stored,
    envDefault: envDefaultUiLocale(),
    deviceLanguage: await readDeviceLocaleTag(),
  });
  activateUiLocale(locale);
  await applyDirection(locale);
  return locale;
}

/** Serialize SecureStore writes so rapid picker taps apply in order (last wins). */
let uiLocaleWriteChain: Promise<void> = Promise.resolve();

/** Forget the saved choice and follow the device language again. */
export async function followDeviceUiLocale(): Promise<UiLocale> {
  const write = uiLocaleWriteChain.then(async () => {
    try {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(UI_LOCALE_STORAGE_KEY);
    } catch {
      // Ignore SecureStore failures; the in-memory locale still applies.
    }
    const locale = resolveUiLocale({
      envDefault: envDefaultUiLocale(),
      deviceLanguage: await readDeviceLocaleTag(),
    });
    activateUiLocale(locale);
    await applyDirection(locale);
    return locale;
  });
  uiLocaleWriteChain = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

export async function persistUiLocale(locale: UiLocale): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore SecureStore failures; in-memory locale still applies.
  }
}

export async function setUiLocale(locale: UiLocale): Promise<UiLocale> {
  const write = uiLocaleWriteChain.then(async () => {
    await persistUiLocale(locale);
    activateUiLocale(locale);
    await applyDirection(locale);
    return locale;
  });
  uiLocaleWriteChain = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

/** Test-only: set the in-memory locale without I/O. */
export function resetI18nForTests(locale: UiLocale = "en"): void {
  activeLocale = locale;
  uiLocaleWriteChain = Promise.resolve();
  emit();
}
