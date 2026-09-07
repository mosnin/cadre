import { describe, expect, it } from "vitest";
import { assertBotLifecycleAllowed, assertBotProfileAllowed, isChippiBot } from "./system-bot.js";

const chippi = { id: `chippi_${"a".repeat(64)}` };
describe("permanent Chippi", () => {
  it("uses reserved identity rather than editable display names", () => {
    expect(isChippiBot(chippi)).toBe(true);
    expect(isChippiBot({ id: "ordinary-bot" })).toBe(false);
    expect(() => assertBotLifecycleAllowed(chippi)).toThrow("permanent");
    expect(() => assertBotLifecycleAllowed({ id: "ordinary-bot" })).not.toThrow();
  });
  it("preserves identity but allows operational profile settings", () => {
    for (const change of [{ name: "Other" }, { pinned: false }, { sectionId: "hidden" }])
      expect(() => assertBotProfileAllowed(chippi, change)).toThrow();
    expect(() =>
      assertBotProfileAllowed(chippi, { name: "Chippi", pinned: true, sectionId: null }),
    ).not.toThrow();
    expect(() => assertBotProfileAllowed(chippi, {})).not.toThrow();
  });
});
