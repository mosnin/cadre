import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageDayStamp } from "./MessageDayStamp";

function atLocal(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month - 1, day, hour, minute);
}

describe("MessageDayStamp", () => {
  it("names today and yesterday", () => {
    i18n.load("en", {});
    i18n.activate("en");
    const now = atLocal(2026, 9, 19, 18, 0).getTime();
    const today = renderToString(
      <I18nProvider i18n={i18n}>
        <MessageDayStamp createdAt={atLocal(2026, 9, 19, 16, 2).toISOString()} nowMs={now} />
      </I18nProvider>,
    );
    expect(today).toContain('data-testid="message-day-separator"');
    expect(today).toContain("Today");

    const yesterday = renderToString(
      <I18nProvider i18n={i18n}>
        <MessageDayStamp createdAt={atLocal(2026, 9, 18, 16, 2).toISOString()} nowMs={now} />
      </I18nProvider>,
    );
    expect(yesterday).toContain("Yesterday");
  });
});
