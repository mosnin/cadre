import { Trans } from "@lingui/react/macro";
import NumberFlow from "@number-flow/react";
import { Gauge } from "lucide-react";
import type { ReactNode } from "react";
import { RAIL } from "./home-tokens";

/**
 * The rail's primary nav and its footer rows.
 *
 * Both are measured: rows sit on a 38px pitch with a 15px icon and 13.5px
 * label, which is the reference's 48.5/19/17 at 1920 divided by 1.27. The
 * rows themselves are Cadre's — a new chat, the schedules that run bots
 * unattended, the computers they run on — not the reference's.
 *
 * Below md these grow back to a 44px touch target, because the rail is a
 * drawer there and 38px rows are not reachable.
 */

export function RailNavRow({
  icon,
  label,
  active,
  onSelect,
  testId,
}: {
  icon: ReactNode;
  label: ReactNode;
  active?: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-start md:min-h-0 ${
        active ? "bg-sidebar-accent text-foreground" : "text-foreground/90 hover:bg-accent/60"
      }`}
      style={{ height: RAIL.navPitch, fontSize: RAIL.navFontSize }}
    >
      <span className="grid shrink-0 place-items-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * What this month has used so far, as a nav row.
 *
 * It was a card: a decorative conic-gradient dot, a headline, a subtitle and
 * a full-width white button, which is the shape the reference uses for its
 * UPGRADE PROMO. Cadre has nothing to promote there, so on a new workspace
 * it sat at the bottom of every rail saying "0 runs and 0 tokens this
 * month" inside a block you could not dismiss and that did not do anything
 * — a permanent advert for a number that is zero. Copying the reference's
 * geometry into a slot with different content is exactly the mistake the
 * measuring is supposed to prevent.
 *
 * So it is a row now, on the same 38px pitch as every other row in the
 * footer, and it navigates. The counts still animate between values,
 * because a run finishing while the rail is open is a change and not a
 * repaint.
 */
export function RailUsage({
  runs,
  tokens,
  onUpgrade,
}: {
  runs: number;
  tokens: number;
  onUpgrade: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onUpgrade}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      style={{ height: RAIL.navPitch, fontSize: RAIL.navFontSize }}
    >
      <span className="grid shrink-0 place-items-center text-muted-foreground">
        <Gauge size={RAIL.navIconSize} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <NumberFlow value={runs} className="font-medium tabular-nums text-foreground" />{" "}
        <Trans>runs</Trans>
        {" \u00b7 "}
        <NumberFlow
          value={tokens}
          format={{ notation: "compact", maximumFractionDigits: 1 }}
          className="font-medium tabular-nums text-foreground"
        />{" "}
        <Trans>tokens</Trans>
      </span>
    </button>
  );
}
