/**
 * Colour for the agent orbs.
 *
 * The orb shader takes three stops — a mid, a light and a dark — and the named
 * presets below are what a new agent gets. A person can point an agent at any
 * colour, so the stops are derived from the agent's own colour rather than
 * chosen from a fixed set: pick a hex, get an orb in it.
 *
 * Shared with the mobile app, which cannot run the shader and draws the same
 * three stops as a gradient.
 */

export type OrbStops = [Rgb, Rgb, Rgb];
type Rgb = [number, number, number];

export type OrbPreset = {
  id: string;
  /** The hex stored on the agent. Everything else is derived from it. */
  color: string;
};

/**
 * The colours a new agent can be given. The first four match the orb's own
 * upstream variants so the presets and the shader agree; the rest widen the
 * set so a workspace of agents is tellable apart at rail size.
 */
export const ORB_PRESETS: OrbPreset[] = [
  { id: "slate", color: "#8C8C99" },
  { id: "blue", color: "#3380FF" },
  { id: "violet", color: "#9A4DFF" },
  { id: "emerald", color: "#26BF8C" },
  { id: "amber", color: "#E9973F" },
  { id: "rose", color: "#E05780" },
  { id: "cyan", color: "#2BB3C9" },
  { id: "lime", color: "#93C13F" },
];

export const DEFAULT_ORB_COLOR = ORB_PRESETS[1]?.color ?? "#3380FF";

/** The preset an agent falls on when it has no colour of its own yet. */
export function orbPresetForSeed(seed: string): OrbPreset {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return ORB_PRESETS[hash % ORB_PRESETS.length] ?? ORB_PRESETS[0]!;
}

/** `#RRGGBB` (or `#RGB`) to 0..1 components. Anything else falls back. */
export function parseHex(color: string): Rgb {
  const raw = color.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return parseHex(DEFAULT_ORB_COLOR);
  return [
    Number.parseInt(full.slice(0, 2), 16) / 255,
    Number.parseInt(full.slice(2, 4), 16) / 255,
    Number.parseInt(full.slice(4, 6), 16) / 255,
  ];
}

function mix(channel: number, towards: number, amount: number): number {
  return Math.min(1, Math.max(0, channel + (towards - channel) * amount));
}

/** Hue-preserving shade. Multiply keeps the colour; a floor avoids a black rim. */
function shade(channel: number): number {
  return Math.max(channel * 0.55, 0.07);
}

/**
 * Three stops from one colour: the colour itself, a pastel lift, and a deep
 * shade of the same hue. The official shader still bookends black and white;
 * these stops have to span a real lightness range or the swirl reads as a
 * bright disc on black.
 */
export function orbStops(color: string): OrbStops {
  const [r, g, b] = parseHex(color);
  return [
    [r, g, b],
    [mix(r, 0.94, 0.4), mix(g, 0.94, 0.4), mix(b, 0.94, 0.4)],
    [shade(r), shade(g), shade(b)],
  ];
}

/** The same three stops as CSS, for the still orb and for React Native. */
export function orbGradientStops(color: string): [string, string, string] {
  const [mid, light, dark] = orbStops(color);
  const css = ([r, g, b]: Rgb) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  return [css(light), css(mid), css(dark)];
}

function hexStop([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * The two colours the ElevenLabs Orb takes. Dark first (the shader's "darker"
 * stop, next to black), then the pastel lift (next to white), so the official
 * black→uColor1→uColor2→white ramp is a hue gradient instead of neon on ink.
 */
export function orbColors(color: string): [string, string] {
  const [, light, dark] = orbStops(color);
  return [hexStop(dark), hexStop(light)];
}

/** A stable seed so the same agent colour keeps the same swirl. */
export function orbSeed(color: string): number {
  let hash = 0;
  for (let index = 0; index < color.length; index += 1) {
    hash = (hash * 31 + color.charCodeAt(index)) >>> 0;
  }
  return hash;
}
