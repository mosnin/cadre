const AWAY_GAP_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function localDayKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * iMessage-style: a stamp when the thread starts, the calendar day changes,
 * or enough time has passed that the next message is a return, not a beat.
 */
export function shouldShowMessageDaySeparator(
  previousCreatedAt: string | undefined,
  createdAt: string,
): boolean {
  if (!previousCreatedAt) return true;
  const previous = Date.parse(previousCreatedAt);
  const current = Date.parse(createdAt);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return false;
  if (Math.abs(current - previous) >= AWAY_GAP_MS) return true;
  return localDayKey(previous) !== localDayKey(current);
}

export type MessageDayKind = "today" | "yesterday" | "absolute";

export function messageDayKind(createdAt: string, nowMs: number): MessageDayKind {
  const current = Date.parse(createdAt);
  if (!Number.isFinite(current) || !Number.isFinite(nowMs)) return "absolute";
  const day = localDayKey(current);
  if (day === localDayKey(nowMs)) return "today";
  if (day === localDayKey(nowMs - DAY_MS)) return "yesterday";
  return "absolute";
}

/** iMessage-style stamp: "Today 4:02 PM", "Yesterday 4:02 PM", or the weekday. */
export function formatMessageDayLabel(createdAt: string, nowMs: number, locale: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const kind = messageDayKind(createdAt, nowMs);
  if (kind === "today" || kind === "yesterday") {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      kind === "today" ? 0 : -1,
      "day",
    );
    return `${capitalizeLocaleWord(day, locale)} ${time}`;
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function capitalizeLocaleWord(value: string, locale: string): string {
  const first = value.charAt(0);
  if (!first) return value;
  return `${first.toLocaleUpperCase(locale)}${value.slice(1)}`;
}
