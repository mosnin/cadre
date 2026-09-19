import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORB_COLOR,
  ORB_PRESETS,
  orbGradientStops,
  orbPresetForSeed,
  orbStops,
  parseHex,
} from "./orb-palette.js";

describe("orb palette", () => {
  it("reads both hex forms", () => {
    expect(parseHex("#ffffff")).toEqual([1, 1, 1]);
    expect(parseHex("#fff")).toEqual([1, 1, 1]);
    expect(parseHex("000000")).toEqual([0, 0, 0]);
  });

  it("falls back rather than handing the shader NaN", () => {
    expect(parseHex("not a colour")).toEqual(parseHex(DEFAULT_ORB_COLOR));
    expect(parseHex("")).toEqual(parseHex(DEFAULT_ORB_COLOR));
  });

  it("puts the light stop above the colour and the dark stop below it", () => {
    const [mid, light, dark] = orbStops("#3380FF");
    for (let channel = 0; channel < 3; channel += 1) {
      expect(light[channel]).toBeGreaterThanOrEqual(mid[channel]!);
      expect(dark[channel]).toBeLessThanOrEqual(mid[channel]!);
    }
  });

  it("stays inside the shader's 0..1 range at both ends", () => {
    for (const color of ["#ffffff", "#000000"]) {
      for (const stop of orbStops(color)) {
        for (const channel of stop) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("gives the same agent the same preset every time", () => {
    expect(orbPresetForSeed("alfred")).toEqual(orbPresetForSeed("alfred"));
    expect(ORB_PRESETS).toContainEqual(orbPresetForSeed("whoever"));
  });

  it("writes CSS the still orb and React Native can both take", () => {
    expect(orbGradientStops("#000000")).toEqual([
      "rgb(82, 82, 82)",
      "rgb(0, 0, 0)",
      "rgb(0, 0, 0)",
    ]);
  });
});
