/** Shown when the runtime cannot enumerate IANA zones (older Hermes builds). */
export const FALLBACK_TIME_ZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Reykjavik",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Zurich",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Kyiv",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Tehran",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Manila",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Pacific/Auckland",
  "UTC",
] as const;

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};

/** Every IANA zone the runtime knows, else the curated fallback. Always includes `extra`. */
export function listTimeZones(extra: readonly (string | null | undefined)[] = []): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length > 0) zones = supported;
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = [...FALLBACK_TIME_ZONES];
  const set = new Set(zones);
  for (const zone of extra) if (zone) set.add(zone);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** "America/New_York" -> "New York". */
export function timeZoneCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** "America/New_York" -> "America" (empty for zones without a region). */
export function timeZoneRegion(zone: string): string {
  const parts = zone.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join(" / ").replace(/_/g, " ") : "";
}

/** Offset like "GMT-4" for a zone at `now`; empty when the runtime cannot format it. */
export function timeZoneOffsetLabel(zone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Case-insensitive match on the zone id, its city, or its region; "_" and " " are equivalent. */
export function searchTimeZones(zones: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "_");
  if (!needle) return [...zones];
  return zones.filter((zone) => zone.toLowerCase().includes(needle));
}

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The preferences patch that keeps a user on automatic time zone in sync with the device.
 * Null when nothing needs to change.
 */
export function automaticTimeZonePatch(
  me: { timezone: string | null; timezoneAutomatic: boolean },
  device: string | null,
): { timezone: string } | null {
  if (!me.timezoneAutomatic || !device) return null;
  return me.timezone === device ? null : { timezone: device };
}
