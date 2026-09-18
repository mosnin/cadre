import { useEffect, useRef } from "react";
import { revealNow } from "../../lib/text-reveal";

/**
 * A bot's name, which sweeps once through a gradient when that bot finishes.
 *
 * The sweep is tied to a transition, not to a value: it fires when `status`
 * crosses from working into done, and not on mount, not on a re-render, and
 * not when a bot that was already done is merely re-listed. A run that is
 * still going, or one that ended by failing or needing a person, does not
 * sweep — the whole point is that the gesture means one thing.
 *
 * `runId` lets a second run on the same row sweep again: the id changes, so
 * the previous completion is not mistaken for this one.
 */
export type BotRunStatus = "idle" | "working" | "done" | "needs-you" | "failed";

export function BotName({
  name,
  status,
  runId,
  className,
  restingColor,
}: {
  name: string;
  status: BotRunStatus;
  runId?: string;
  className?: string;
  restingColor?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<{ status: BotRunStatus; runId?: string } | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { status, runId };

    // Nothing to celebrate on first paint: a bot that was already done before
    // this row mounted did not just finish.
    if (!before) return;

    const finishedNow = before.status === "working" && status === "done";
    const newRun = before.runId !== runId;
    if (!finishedNow) return;

    revealNow(ref.current, { replay: newRun });
  }, [status, runId]);

  return (
    <span
      ref={ref}
      data-reveal-06
      data-duration="1.1"
      data-delay="0"
      data-resting-color={restingColor}
      className={className}
    >
      {name}
    </span>
  );
}
