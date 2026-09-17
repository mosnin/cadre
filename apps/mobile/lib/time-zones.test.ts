import { describe, expect, it } from "vitest";
import {
  automaticTimeZonePatch,
  FALLBACK_TIME_ZONES,
  listTimeZones,
  searchTimeZones,
  timeZoneCity,
  timeZoneOffsetLabel,
  timeZoneRegion,
} from "./time-zones";

describe("time zones", () => {
  it("lists sorted unique zones and always includes the current one", () => {
    const zones = listTimeZones(["Custom/Zone", null, undefined]);
    expect(zones).toContain("Custom/Zone");
    expect(zones).toContain("America/New_York");
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
  });

  it("searches by city, region, or id and treats spaces as underscores", () => {
    const zones = [...FALLBACK_TIME_ZONES];
    expect(searchTimeZones(zones, "new york")).toEqual(["America/New_York"]);
    expect(searchTimeZones(zones, "  ")).toEqual(zones);
    expect(searchTimeZones(zones, "australia")).toEqual([
      "Australia/Perth",
      "Australia/Adelaide",
      "Australia/Sydney",
      "Australia/Brisbane",
    ]);
    expect(searchTimeZones(zones, "nowhere")).toEqual([]);
  });

  it("splits ids into city and region labels", () => {
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneRegion("America/Argentina/Buenos_Aires")).toBe("America / Argentina");
    expect(timeZoneCity("UTC")).toBe("UTC");
    expect(timeZoneRegion("UTC")).toBe("");
  });

  it("formats an offset and tolerates unknown zones", () => {
    expect(timeZoneOffsetLabel("UTC", new Date("2026-01-15T12:00:00Z"))).toMatch(/^GMT(\+0)?$/);
    expect(timeZoneOffsetLabel("Asia/Tokyo", new Date("2026-01-15T12:00:00Z"))).toBe("GMT+9");
    expect(timeZoneOffsetLabel("Not/A_Zone")).toBe("");
  });

  it("only patches the time zone while automatic and out of sync", () => {
    expect(
      automaticTimeZonePatch({ timezone: null, timezoneAutomatic: true }, "Europe/Paris"),
    ).toEqual({ timezone: "Europe/Paris" });
    expect(
      automaticTimeZonePatch({ timezone: "Europe/Paris", timezoneAutomatic: true }, "Europe/Paris"),
    ).toBeNull();
    expect(
      automaticTimeZonePatch({ timezone: "UTC", timezoneAutomatic: false }, "Europe/Paris"),
    ).toBeNull();
    expect(automaticTimeZonePatch({ timezone: null, timezoneAutomatic: true }, null)).toBeNull();
  });
});
