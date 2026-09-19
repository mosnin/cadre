import { i18n } from "@lingui/core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { MessageDayStamp } from "./MessageDayStamp";

function atLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("MessageDayStamp", () => {
  afterEach(() => {
    i18n.load("en", {});
    i18n.activate("en");
  });

  it("names today and yesterday", () => {
    i18n.load("en", {});
    i18n.activate("en");
    const now = atLocal(2026, 9, 19, 18, 0).getTime();
    const today = renderToStaticMarkup(
      <MessageDayStamp createdAt={atLocal(2026, 9, 19, 16, 2).toISOString()} nowMs={now} />,
    );
    expect(today).toContain('data-testid="message-day-separator"');
    expect(today).toContain("Today");

    const yesterday = renderToStaticMarkup(
      <MessageDayStamp createdAt={atLocal(2026, 9, 18, 16, 2).toISOString()} nowMs={now} />,
    );
    expect(yesterday).toContain("Yesterday");
  });
});
