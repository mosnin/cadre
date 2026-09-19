import { cn } from "@cadre/ui-web";
import { ShimmeringText } from "@cadre/ui-web/components/ui/shimmering-text";
import { Loader } from "@cadre/ui-web/directory/loader";
import { type ReactNode, useEffect, useState } from "react";

/** Format wall-clock seconds since `startedAtMs` as `0.0s` / `1m 2.3s`. */
export function formatElapsed(startedAtMs: number, nowMs: number): string {
  const totalTenths = Math.round(Math.max(0, nowMs - startedAtMs) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  if (minutes === 0) return `${seconds.toFixed(1)}s`;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {formatElapsed(startedAt, now)}
    </span>
  );
}
export function LoadingState({
  indicator,
  label = "Thinking",
  startedAt,
}: {
  indicator?: ReactNode;
  label?: string;
  startedAt?: number;
}) {
  return (
    <span role="status" className="flex w-fit items-center gap-2.5">
      {indicator ? (
        indicator
      ) : (
        <span aria-hidden="true">
          <Loader size={18} label={label} />
        </span>
      )}
      <ShimmeringText text={label} startOnView={false} className="text-sm" />
      {startedAt !== undefined ? <Elapsed startedAt={startedAt} /> : null}
    </span>
  );
}
export function SuccessStatus({ label }: { label: string }) {
  return (
    <span role="status" className="text-sm text-foreground">
      {label}
    </span>
  );
}

/** Shared surface for connection requests. */
export function BuiCard({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cn("rounded-2xl bg-card", className)} />;
}
