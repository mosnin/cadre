import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORB_COLOR,
  ORB_PRESETS,
  orbColors,
  orbGradientStops,
  orbPresetForSeed,
  orbSeed,
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

  it("puts the pastel stop brighter than the colour and the shade darker", () => {
    const luma = ([r, g, b]: readonly [number, number, number]) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;
    const [mid, light, dark] = orbStops("#3380FF");
    expect(luma(light)).toBeGreaterThan(luma(mid));
    expect(luma(dark)).toBeLessThan(luma(mid));
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
      "rgb(81, 81, 81)",
      "rgb(0, 0, 0)",
      "rgb(11, 11, 11)",
    ]);
  });

  it("hands the ElevenLabs Orb a dark/mid pair from the agent's colour", () => {
    expect(orbColors("#3380FF")).toEqual(["#3069c7", "#3380ff"]);
    expect(orbSeed("#3380FF")).toBe(orbSeed("#3380FF"));
    expect(orbSeed("#3380FF")).not.toBe(orbSeed("#26BF8C"));
  });
});
