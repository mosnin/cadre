import { messageDayKind } from "@cadre/core";
import { useLingui } from "@lingui/react/macro";

export function MessageDayStamp({ createdAt, nowMs }: { createdAt: string; nowMs?: number }) {
  const { i18n, t } = useLingui();
  const when = new Date(createdAt);
  const time = new Intl.DateTimeFormat(i18n.locale || "en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(when);
  const kind = messageDayKind(createdAt, nowMs ?? Date.now());
  const label =
    kind === "today"
      ? t`Today ${time}`
      : kind === "yesterday"
        ? t`Yesterday ${time}`
        : new Intl.DateTimeFormat(i18n.locale || "en", {
            weekday: "long",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(when);

  return (
    <time
      dateTime={createdAt}
      data-testid="message-day-separator"
      className="mx-auto my-3 block text-center text-[12px] text-muted-foreground"
    >
      {label}
    </time>
  );
}
