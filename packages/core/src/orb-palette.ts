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

/**
 * Three stops from one colour: the colour itself, a lift towards white and a
 * drop towards black. The amounts are the distance the upstream variants keep
 * between their own stops, so a derived palette reads like a designed one.
 */
export function orbStops(color: string): OrbStops {
  const [r, g, b] = parseHex(color);
  return [
    [r, g, b],
    [mix(r, 1, 0.32), mix(g, 1, 0.32), mix(b, 1, 0.32)],
    [mix(r, 0, 0.38), mix(g, 0, 0.38), mix(b, 0, 0.38)],
  ];
}

/**
 * The two stops the live orb takes.
 *
 * Not the same three as the still orb, and the difference is the whole
 * point. The still orb's stops are FAR apart — lifted 32% toward white and
 * dropped 38% toward black — because a CSS radial gradient has to carry the
 * whole impression of a sphere in one paint. The live orb has a shader and
 * a noise field doing that work, and it mixes between its two colours
 * across that field: hand it a near-white and a saturated body and the mix
 * lands in hard wedges, which is a pinwheel, not an orb. Upstream's own
 * default pair sits about 0.12 apart in lightness; this is the agent's
 * colour lifted and dropped by 0.12 either side of it.
 */
/**
 * The two stops the ElevenLabs orb shader ramps between (black -> stop1 ->
 * stop2 -> white). Their own default pair, #CADCFC / #A0B9D1, is one hue held
 * at two lightnesses far up the scale: L 0.89 at S 0.89, then L 0.72 at S 0.35,
 * with the second stop about 9 degrees cooler. Feeding a brand colour in at
 * full saturation instead makes the shader's petals read as a hard pinwheel, so
 * the agent's hue is re-set to that pair's lightness and chroma.
 */
export function orbLiveStops(color: string): [string, string] {
  const [hue, sat] = hueAndSaturation(color);
  return [hsl(hue, Math.min(Math.max(sat, 0.55), 0.89), 0.89), hsl(hue - 9, 0.35, 0.72)];
}

function hueAndSaturation(color: string): [number, number] {
  const [r, g, b] = parseHex(color);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const lightness = (max + min) / 2;
  if (span === 0) return [0, 0];
  const saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min);
  let hue: number;
  if (max === r) hue = (g - b) / span + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  return [hue * 60, saturation];
}

function hsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const table: Rgb[] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sector] ?? [0, 0, 0];
  const to255 = (n: number) => Math.round((n + m) * 255);
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

/** The same three stops as CSS, for the still orb and for React Native. */
export function orbGradientStops(color: string): [string, string, string] {
  const [mid, light, dark] = orbStops(color);
  const css = ([r, g, b]: Rgb) =>
    `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  return [css(light), css(mid), css(dark)];
}
