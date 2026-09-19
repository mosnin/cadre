import { describe, expect, it } from "vitest";
import {
  formatMessageDayLabel,
  messageDayKind,
  shouldShowMessageDaySeparator,
} from "./message-day.js";

function atLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("message day separators", () => {
  it("shows a stamp on the first message", () => {
    expect(
      shouldShowMessageDaySeparator(undefined, atLocal(2026, 9, 19, 16, 0).toISOString()),
    ).toBe(true);
  });

  it("hides a stamp for a follow-up in the same hour", () => {
    expect(
      shouldShowMessageDaySeparator(
        atLocal(2026, 9, 19, 16, 0).toISOString(),
        atLocal(2026, 9, 19, 16, 12).toISOString(),
      ),
    ).toBe(false);
  });

  it("shows a stamp after an hour away", () => {
    expect(
      shouldShowMessageDaySeparator(
        atLocal(2026, 9, 19, 14, 0).toISOString(),
        atLocal(2026, 9, 19, 16, 0).toISOString(),
      ),
    ).toBe(true);
  });

  it("shows a stamp when the calendar day changes", () => {
    expect(
      shouldShowMessageDaySeparator(
        atLocal(2026, 9, 18, 23, 50).toISOString(),
        atLocal(2026, 9, 19, 0, 10).toISOString(),
      ),
    ).toBe(true);
  });

  it("names today and yesterday from the given now", () => {
    const now = atLocal(2026, 9, 19, 18, 0).getTime();
    expect(messageDayKind(atLocal(2026, 9, 19, 16, 0).toISOString(), now)).toBe("today");
    expect(messageDayKind(atLocal(2026, 9, 18, 16, 0).toISOString(), now)).toBe("yesterday");
    expect(messageDayKind(atLocal(2026, 9, 10, 16, 0).toISOString(), now)).toBe("absolute");
  });

  it("formats today and yesterday in English", () => {
    const now = atLocal(2026, 9, 19, 18, 0).getTime();
    expect(formatMessageDayLabel(atLocal(2026, 9, 19, 16, 2).toISOString(), now, "en")).toMatch(
      /^Today /,
    );
    expect(formatMessageDayLabel(atLocal(2026, 9, 18, 16, 2).toISOString(), now, "en")).toMatch(
      /^Yesterday /,
    );
  });
});
