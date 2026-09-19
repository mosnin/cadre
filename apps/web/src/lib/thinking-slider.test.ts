import { describe, expect, it } from "vitest";
import { thinkingSliderIndex } from "./thinking-slider";

describe("thinkingSliderIndex", () => {
  const levels = ["minimal", "low", "medium", "high", "xhigh"] as const;

  it("maps a stored level onto its step", () => {
    expect(thinkingSliderIndex(levels, "high")).toBe(3);
  });

  it("rests on medium when the bot still uses the default", () => {
    expect(thinkingSliderIndex(levels, "")).toBe(2);
  });

  it("uses the middle step when medium is not available", () => {
    expect(thinkingSliderIndex(["low", "high", "max"], "")).toBe(1);
  });
});
