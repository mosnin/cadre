/** Curated ISO 3166-1 alpha-2 codes for runtimes that cannot enumerate regions. */
export const FALLBACK_REGIONS = [
  "AR",
  "AU",
  "AT",
  "BE",
  "BR",
  "CA",
  "CL",
  "CN",
  "CO",
  "CZ",
  "DK",
  "EG",
  "FI",
  "FR",
  "DE",
  "GR",
  "HK",
  "IN",
  "ID",
  "IE",
  "IL",
  "IT",
  "JP",
  "KE",
  "KR",
  "MX",
  "NL",
  "NZ",
  "NG",
  "NO",
  "PE",
  "PH",
  "PL",
  "PT",
  "RU",
  "SA",
  "SG",
  "ZA",
  "ES",
  "SE",
  "CH",
  "TW",
  "TH",
  "TR",
  "UA",
  "AE",
  "GB",
  "US",
  "VN",
] as const;

const REGION_CODE = /^[A-Z]{2}$/;

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};

type IntlWithDisplayNames = typeof Intl & {
  DisplayNames?: new (
    locales: string | string[],
    options: { type: "region"; fallback: "none" },
  ) => { of: (code: string) => string | undefined };
};

/** Human name for a region code in `locale`, else the code itself. */
export function regionName(code: string, locale: string): string {
  try {
    const DisplayNames = (Intl as IntlWithDisplayNames).DisplayNames;
    if (!DisplayNames) return code;
    const name = new DisplayNames([locale], { type: "region", fallback: "none" }).of(code);
    return name || code;
  } catch {
    return code;
  }
}

export type RegionOption = { code: string; name: string };

/** Regions sorted by their name in `locale`. Always includes `extra`. */
export function listRegions(
  locale: string,
  extra: readonly (string | null | undefined)[] = [],
): RegionOption[] {
  let codes: string[] = [];
  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.("region");
    if (Array.isArray(supported)) codes = supported.filter((code) => REGION_CODE.test(code));
  } catch {
    codes = [];
  }
  if (codes.length === 0) codes = [...FALLBACK_REGIONS];
  const set = new Set(codes);
  for (const code of extra) if (code && REGION_CODE.test(code)) set.add(code);
  return [...set]
    .map((code) => ({ code, name: regionName(code, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function searchRegions(regions: readonly RegionOption[], query: string): RegionOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...regions];
  return regions.filter(
    (region) =>
      region.name.toLowerCase().includes(needle) || region.code.toLowerCase().includes(needle),
  );
}

/** Region subtag of a locale tag, such as "US" from "en-US"; reads the device locale when omitted. */
export function deviceRegion(localeTag?: string | null): string | null {
  let tag = localeTag;
  if (tag === undefined) {
    try {
      tag = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      tag = null;
    }
  }
  if (!tag) return null;
  const region = tag
    .replace(/_/g, "-")
    .split("-")
    .slice(1)
    .find((part) => REGION_CODE.test(part.toUpperCase()) && part.length === 2);
  return region ? region.toUpperCase() : null;
}
