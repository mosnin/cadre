import { formatMessageDayLabel } from "@cadre/core";
import { i18n } from "@lingui/core";

export function MessageDayStamp({ createdAt, nowMs }: { createdAt: string; nowMs?: number }) {
  return (
    <time
      dateTime={createdAt}
      data-testid="message-day-separator"
      className="mx-auto my-3 block text-center text-[12px] text-muted-foreground"
    >
      {formatMessageDayLabel(createdAt, nowMs ?? Date.now(), i18n.locale || "en")}
    </time>
  );
}
