import NumberFlow from "@number-flow/react";
import { useEffect, useRef, useState } from "react";
import { routineNumberFlowDelayMs, routineRunClock } from "../lib/routine-run-clock";

export function RoutineRunClock({ iso, index }: { iso: string | null; index: number }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const clock = routineRunClock(iso);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !iso) return;

    let timer = 0;
    const reveal = () => {
      timer = window.setTimeout(() => setShown(true), routineNumberFlowDelayMs(index));
    };

    if (!("IntersectionObserver" in window)) {
      reveal();
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        reveal();
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [index, iso]);

  if (!clock) return null;

  return (
    <span
      ref={rootRef}
      className="nf-number shrink-0 font-medium tabular-nums text-muted-foreground/80"
      data-testid="routine-run-clock"
    >
      <NumberFlow
        value={shown ? clock.hour : 0}
        trend={1}
        format={{ minimumIntegerDigits: 1, maximumFractionDigits: 0 }}
        className="tabular-nums"
      />
      <span aria-hidden>:</span>
      <NumberFlow
        value={shown ? clock.minute : 0}
        trend={1}
        format={{ minimumIntegerDigits: 2, maximumFractionDigits: 0 }}
        className="tabular-nums"
        data-will-change
      />
    </span>
  );
}
