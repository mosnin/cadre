import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import { useEffect, useRef } from "react";
import { revealNow } from "../../lib/text-reveal";

/**
 * A bot's name in the rail, which sweeps once through a gradient the moment
 * that bot finishes a run.
 *
 * The sweep is tied to a transition, not to a value. It fires when the bot
 * crosses from an active run status into a finished one — not on mount, not on
 * a re-render, and not when a bot that was already finished is merely
 * re-listed. A run that is still going, or one that ended needing a person,
 * does not sweep: the gesture has to mean exactly one thing or it means
 * nothing.
 *
 * `runKey` distinguishes one run from the next — the row's own updatedAt, which
 * moves when a run ends — so a second completion sweeps again rather than being
 * mistaken for the first.
 */
export function BotNameSweep({
  name,
  status,
  runKey,
  className,
}: {
  name: string;
  status: string;
  runKey?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ active: boolean; runKey?: string } | null>(null);

  useEffect(() => {
    const active = ACTIVE_RUN_STATUSES.some((candidate) => candidate === status);
    const before = previous.current;
    previous.current = { active, runKey };

    // A bot that was already finished before this row mounted did not just
    // finish, so first paint never sweeps.
    if (!before) return;
    if (!(before.active && !active)) return;

    revealNow(ref.current, { replay: before.runKey !== runKey });
  }, [status, runKey]);

  return (
    <span ref={ref} data-reveal-06 data-duration="1.1" data-delay="0" className={className}>
      {name}
    </span>
  );
}
