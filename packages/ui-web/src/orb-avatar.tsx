/**
 * The agent orb.
 *
 * The live visual is ElevenLabs' Orb (`npx @elevenlabs/cli@latest components add orb`),
 * filling the whole circle. Colour comes from the agent. A browser allows only
 * a handful of WebGL contexts, so off-screen orbs wait their turn; the fill
 * underneath is the agent's colour gradient, not a second invented orb.
 */
import { LIVE_ORB_MIN_SIZE, orbGradientStops } from "@cadre/core";
import { lazy, memo, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "muted";

const LiveOrb = lazy(async () => {
  const module = await import("./orb-avatar-live.js");
  return { default: module.LiveOrb };
});

function subscribeToReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionSnapshot() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface OrbAvatarProps {
  /** The agent's colour. Every stop the orb draws comes from it. */
  color: string;
  size?: number;
  state?: OrbState;
  /** 0..1, when there is a live signal to drive it. */
  volume?: number;
  className?: string;
}

export const OrbAvatar = memo(function OrbAvatar({
  color,
  size = 38,
  state = "idle",
  volume = 0,
  className,
}: OrbAvatarProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const wantsLive = hydrated && size >= LIVE_ORB_MIN_SIZE && !reducedMotion;
  const [light, mid, dark] = orbGradientStops(color);

  return (
    <span
      aria-hidden="true"
      data-orb-state={state}
      data-working={state === "speaking" ? "true" : "false"}
      data-halo={!wantsLive && state === "speaking" ? "true" : undefined}
      className={cn(
        "cadre-orb pointer-events-none relative inline-block shrink-0 overflow-hidden rounded-full",
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 38% 32%, ${light} 0%, ${mid} 52%, ${dark} 100%)`,
        contain: "strict",
      }}
    >
      {wantsLive ? (
        <Suspense fallback={null}>
          <LiveOrb color={color} state={state} volume={volume} />
        </Suspense>
      ) : null}
    </span>
  );
});
