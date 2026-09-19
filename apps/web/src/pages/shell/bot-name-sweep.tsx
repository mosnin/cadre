import { ACTIVE_RUN_STATUSES } from "@cadre/core";
import { ShimmeringText } from "@cadre/ui-web/components/ui/shimmering-text";
import { useEffect, useRef, useState } from "react";

const SHIMMER_MS = 2300;

export function shouldSweepBotName(
  before: { active: boolean; runKey?: string } | null,
  next: { active: boolean; runKey?: string },
): boolean {
  if (!before) return false;
  return before.active && !next.active;
}

/**
 * Official ElevenLabs shimmer on a bot's name, once, when that bot finishes.
 * First paint never shimmers. Waiting on a person does not count as finished.
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
  const previous = useRef<{ active: boolean; runKey?: string } | null>(null);
  const [sweepKey, setSweepKey] = useState(0);

  useEffect(() => {
    const active = ACTIVE_RUN_STATUSES.some((candidate) => candidate === status);
    const before = previous.current;
    const next = { active, runKey };
    previous.current = next;
    if (!shouldSweepBotName(before, next)) return;

    setSweepKey((current) => current + 1);
    const timer = window.setTimeout(() => setSweepKey(0), SHIMMER_MS);
    return () => window.clearTimeout(timer);
  }, [runKey, status]);

  if (sweepKey > 0) {
    return (
      <ShimmeringText
        key={sweepKey}
        text={name}
        className={className}
        startOnView={false}
        once
        repeat={false}
      />
    );
  }

  return <span className={className}>{name}</span>;
}
