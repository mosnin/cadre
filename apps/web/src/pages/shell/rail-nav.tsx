import { Trans, useLingui } from "@lingui/react/macro";
import NumberFlow from "@number-flow/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { RAIL } from "./home-tokens";

/**
 * The rail's primary nav and its footer card.
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
      className={`flex h-11 w-full shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-start md:h-[38px] ${
        active ? "bg-sidebar-accent text-foreground" : "text-foreground/90 hover:bg-accent/60"
      }`}
      style={{ fontSize: RAIL.navFontSize }}
    >
      <span className="grid shrink-0 place-items-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * The reference's footer block, on Cadre's numbers: what this month has used
 * so far and the way to lift the cap. The counts animate between values
 * because they change while the rail is open — a run finishing is a change,
 * not a repaint.
 */
export function RailUsage({
  runs,
  tokens,
  onUpgrade,
  onDismiss,
}: {
  runs: number;
  tokens: number;
  onUpgrade: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="relative rounded-xl bg-sidebar-accent/70 p-3" data-testid="rail-usage">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t`Dismiss usage`}
        data-testid="rail-usage-dismiss"
        className="absolute top-1.5 end-1.5 grid size-8 place-items-center rounded-md text-foreground/75 hover:bg-accent hover:text-foreground"
      >
        <X size={15} strokeWidth={1.75} />
      </button>
      <span
        aria-hidden
        className="mb-2.5 block size-5 rounded-full"
        style={{
          background:
            "conic-gradient(from 180deg, var(--primary), color-mix(in oklab, var(--primary) 30%, transparent), var(--primary))",
        }}
      />
      <p className="text-[11.8px] leading-[1.35] text-foreground">
        <NumberFlow value={runs} className="font-medium tabular-nums" /> <Trans>runs and</Trans>{" "}
        <NumberFlow
          value={tokens}
          format={{ notation: "compact", maximumFractionDigits: 1 }}
          className="font-medium tabular-nums"
        />{" "}
        <Trans>tokens this month</Trans>
      </p>
      <p className="mt-0.5 text-[10.2px] text-muted-foreground">
        <Trans>See what your bots have been spending</Trans>
      </p>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-2.5 h-[35px] w-full rounded-full bg-primary text-[12.5px] font-medium text-primary-foreground"
      >
        <Trans>See usage</Trans>
      </button>
    </div>
  );
}
