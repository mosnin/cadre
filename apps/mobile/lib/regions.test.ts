import { describe, expect, it } from "vitest";
import { deviceRegion, listRegions, regionName, searchRegions } from "./regions";

describe("regions", () => {
  it("names regions in the requested locale and falls back to the code", () => {
    expect(regionName("US", "en")).toBe("United States");
    expect(regionName("JP", "zh-CN")).toBe("日本");
    expect(regionName("AA", "en")).toBe("AA");
  });

  it("lists regions sorted by name and always includes the current one", () => {
    const regions = listRegions("en", ["XK", "us", null]);
    expect(regions.map((region) => region.code)).toContain("XK");
    expect(regions.map((region) => region.code)).toContain("US");
    expect(regions.map((region) => region.code)).not.toContain("us");
    expect(new Set(regions.map((region) => region.code)).size).toBe(regions.length);
    const names = regions.map((region) => region.name);
    expect([...names].sort((a, b) => a.localeCompare(b, "en"))).toEqual(names);
  });

  it("searches by name or code", () => {
    const regions = listRegions("en");
    expect(searchRegions(regions, "united k").map((region) => region.code)).toEqual(["GB"]);
    expect(searchRegions(regions, "jp").map((region) => region.code)).toContain("JP");
    expect(searchRegions(regions, "")).toEqual(regions);
  });

  it("reads the region subtag from a locale tag", () => {
    expect(deviceRegion("en-US")).toBe("US");
    expect(deviceRegion("zh-Hans-CN")).toBe("CN");
    expect(deviceRegion("pt_BR")).toBe("BR");
    expect(deviceRegion("fr")).toBeNull();
    expect(deviceRegion("")).toBeNull();
  });
});
