import { describe, expect, it } from "vitest";
import { shouldSweepBotName } from "./bot-name-sweep";

describe("shouldSweepBotName", () => {
  it("does not sweep on first paint", () => {
    expect(shouldSweepBotName(null, { active: false })).toBe(false);
    expect(shouldSweepBotName(null, { active: true })).toBe(false);
  });

  it("sweeps when a run finishes", () => {
    expect(shouldSweepBotName({ active: true, runKey: "a" }, { active: false, runKey: "b" })).toBe(
      true,
    );
  });

  it("does not sweep while work is still going", () => {
    expect(shouldSweepBotName({ active: true }, { active: true })).toBe(false);
  });
});
