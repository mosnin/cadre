import { orbColors, orbSeed } from "@cadre/core";
import { useEffect, useRef, useState } from "react";
import type { AgentState } from "./components/ui/orb.js";
import { Orb } from "./components/ui/orb.js";
import type { OrbState } from "./orb-avatar.js";

const LIVE_ORB_BUDGET = 16;

let liveOrbs = 0;
const budgetListeners = new Set<() => void>();
function claimOrb(): boolean {
  if (liveOrbs >= LIVE_ORB_BUDGET) return false;
  liveOrbs += 1;
  return true;
}
function releaseOrb(): void {
  liveOrbs = Math.max(0, liveOrbs - 1);
  for (const listener of budgetListeners) listener();
}

function agentStateFor(state: OrbState): AgentState {
  if (state === "listening") return "listening";
  if (state === "speaking") return "talking";
  if (state === "connecting") return "thinking";
  return null;
}

export function LiveOrb({
  color,
  state,
}: {
  color: string;
  state: OrbState;
  volume: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [hasBudget, setHasBudget] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    let seenIntersecting = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          seenIntersecting = true;
          setOnScreen(true);
          return;
        }
        // Layout can report a miss before the first paint. Keep the official
        // orb mounted until a later observation confirms it left the rail.
        if (!seenIntersecting) return;
        setOnScreen(false);
      },
      { rootMargin: "96px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const [budgetEpoch, setBudgetEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setBudgetEpoch((value) => value + 1);
    budgetListeners.add(bump);
    return () => {
      budgetListeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!onScreen) {
      setHasBudget(false);
      return;
    }
    if (!claimOrb()) {
      setHasBudget(false);
      return;
    }
    setHasBudget(true);
    return () => {
      releaseOrb();
      setHasBudget(false);
    };
  }, [onScreen, budgetEpoch]);

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden"
      data-orb-engine={hasBudget ? "elevenlabs" : undefined}
    >
      {hasBudget ? (
        <Orb
          className="pointer-events-none h-full w-full"
          colors={orbColors(color)}
          seed={orbSeed(color)}
          agentState={agentStateFor(state)}
          volumeMode="auto"
        />
      ) : null}
    </div>
  );
}
