/**
 * The agent orb.
 *
 * A live orb is ElevenLabs' own `Orb`, vendored verbatim in `eleven-orb.tsx`
 * (MIT, see eleven-orb.LICENSE). What is ours is the colour and the budget:
 *
 * - **Colour** comes from the agent's own `color`. `orbLiveStops` re-sets that
 *   hue to the lightness and chroma ElevenLabs' shader expects, and `orbStops`
 *   draws the still orb. An agent is whatever colour it was given, and
 *   `ORB_PRESETS` is what it starts as.
 * - **Budget.** A browser allows a handful of live WebGL contexts and then
 *   starts dropping the oldest. A workspace rail can show twenty agents, so
 *   only orbs big enough to show the motion take a context, and only while
 *   they are on screen and motion is allowed. Everything else draws the same
 *   three stops as a still gradient, which is what the rail wants anyway.
 */
import { orbLiveStops, orbStops } from "@cadre/core";
import {
  type CSSProperties,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentState as ElevenAgentState } from "./eleven-orb.js";
import { cn } from "./lib/utils.js";
import "./styles.css";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "muted";

/** Below this the motion is not readable, so it is not worth a context. */
const LIVE_ORB_MIN_SIZE = 40;
/** Browsers start evicting the oldest context past roughly this many. */
const LIVE_ORB_BUDGET = 6;

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

const reducedMotionMedia = "(prefers-reduced-motion: reduce)";
function reducedMotionSnapshot(): boolean {
  return window.matchMedia(reducedMotionMedia).matches;
}
function subscribeToReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(reducedMotionMedia);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export interface OrbAvatarProps {
  /** The agent's colour. Every stop the shader draws comes from it. */
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
  const wantsLive = size >= LIVE_ORB_MIN_SIZE && !reducedMotion;
  const [light, mid, dark] = gradientFor(color);

  return (
    <span
      aria-hidden="true"
      data-orb-state={state}
      // Whether a run is in flight, always stated so a caller can count or
      // assert on it.
      data-working={state === "speaking" ? "true" : "false"}
      // Only the still orb breathes: a live one already shows the run in its
      // own motion, and two signals at once reads as a glitch.
      data-halo={!wantsLive && state === "speaking" ? "true" : undefined}
      className={cn("cadre-orb relative inline-block shrink-0 rounded-full", className)}
      style={
        {
          width: size,
          height: size,
          "--cadre-orb-halo": `color-mix(in oklab, ${mid} 45%, transparent)`,
        } as CSSProperties
      }
    >
      {/* The still orb is always drawn: it is what shows before the context
          is claimed, and what stays when there is none to claim — which, at
          the sizes the rail and the transcript use, is EVERYWHERE. So it is
          the orb, for almost every orb on screen, and it was a single
          radial gradient. A single radial gradient at 28px is a flat disc.

          Two spheres were tried. Lit-from-outside — bright top-left, dark
          bottom-right, a hard specular — gives a snooker ball: convincingly
          round and cheap-looking, because a plastic highlight is the most
          plastic thing there is. What reads as considered is lit from
          WITHIN: the colour concentrated in a core, falling to near the
          ground at the rim, with a thin backlight where the edge catches
          and a sheen so broad it has no edge of its own. Glass, not
          snooker.

          Four stacked backgrounds and one paint:
            1. rim — a hairline of the light stop just inside the edge;
            2. sheen — wide, low, no hard dot anywhere in it;
            3. core — the colour, brightest off-centre toward the light;
            4. seat — the rim darkened opposite the core. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: [
            `radial-gradient(circle at 50% 50%, transparent 56%, color-mix(in oklab, ${light} 45%, transparent) 76%, transparent 96%)`,
            `radial-gradient(78% 66% at 36% 24%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 42%, transparent 70%)`,
            `radial-gradient(circle at 42% 36%, ${light} 0%, ${mid} 38%, ${dark} 76%, color-mix(in oklab, ${dark} 78%, black) 100%)`,
          ].join(", "),
          boxShadow: [
            `inset -1px -2px 7px color-mix(in oklab, ${dark} 62%, black)`,
            `inset 0 0 0 0.5px color-mix(in oklab, ${dark} 45%, transparent)`,
            `0 0 10px color-mix(in oklab, ${mid} 18%, transparent)`,
          ].join(", "),
        }}
      />
      {wantsLive ? <LiveOrb color={color} state={state} volume={volume} /> : null}
    </span>
  );
});

function gradientFor(color: string): [string, string, string] {
  const [midStop, lightStop, darkStop] = orbStops(color);
  const css = (stop: readonly [number, number, number]) =>
    `rgb(${stop.map((channel) => Math.round(channel * 255)).join(", ")})`;
  return [css(lightStop), css(midStop), css(darkStop)];
}

/**
 * ElevenLabs' Orb, under this product's budget.
 *
 * The orb itself is `eleven-orb.tsx`, vendored verbatim. What lives here is
 * everything that has to be true before one of them may exist:
 *
 *   · it is on screen. An orb below the fold is not worth a context, and
 *     giving one up lets the next orb that scrolls into view take it;
 *   · there is a context to take. A browser evicts the oldest WebGL context
 *     past roughly six, and a rail can list twenty agents, so the budget is
 *     a counter and the losers draw the still orb — which is the same
 *     shape, so nothing jumps when one wins or loses;
 *   · three.js has arrived. It is ~600KB and the app must not pay for it on
 *     a first paint that may never show a live orb at all, so the import is
 *     lazy and the fallback is the still orb that is already painted under
 *     it.
 */
const ElevenOrb = lazy(async () => {
  const mod = await import("./eleven-orb");
  return { default: mod.Orb };
});

/** Our states, in the four words the orb knows. */
function agentStateFor(state: OrbState): ElevenAgentState {
  if (state === "listening") return "listening";
  if (state === "connecting") return "thinking";
  if (state === "speaking") return "talking";
  return null;
}

function LiveOrb({ color, state, volume }: { color: string; state: OrbState; volume: number }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [budgetEpoch, setBudgetEpoch] = useState(0);
  const [claimed, setClaimed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(Boolean(entry?.isIntersecting)),
      { rootMargin: "64px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const bump = () => setBudgetEpoch((value) => value + 1);
    budgetListeners.add(bump);
    return () => {
      budgetListeners.delete(bump);
    };
  }, []);

  useEffect(() => {
    if (!onScreen) {
      setClaimed(false);
      return;
    }
    if (!claimOrb()) {
      setClaimed(false);
      return;
    }
    setClaimed(true);
    return () => {
      setClaimed(false);
      releaseOrb();
    };
    // budgetEpoch re-runs this when another orb gives its context back.
  }, [onScreen, budgetEpoch]);

  // Two stops, which is the orb's own API: the agent's hue at the lightness
  // and chroma the shader ramps against, so a blue agent is a blue orb rather
  // than the one periwinkle pair the component ships as its default.
  return (
    // The orb draws a disc of radius 3.5 through a default 75-degree camera
    // five units back, so it covers 91% of the canvas and leaves a margin the
    // still orb's rim shows through as a bright ring. 1 / 0.91 closes it.
    <span ref={hostRef} className="absolute inset-0 scale-[1.1] overflow-hidden rounded-full">
      {claimed ? (
        <Suspense fallback={null}>
          <ElevenOrb
            colors={orbLiveStops(color)}
            agentState={agentStateFor(state)}
            // `auto` asks the browser for a microphone. An avatar in a list
            // does not get to do that; the volume it has is the one the
            // caller hands it.
            volumeMode="manual"
            manualInput={state === "listening" ? volume : 0}
            manualOutput={state === "speaking" ? volume : 0}
            className="relative h-full w-full"
          />
        </Suspense>
      ) : null}
    </span>
  );
}
