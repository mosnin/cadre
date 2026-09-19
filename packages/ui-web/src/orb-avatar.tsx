/**
 * The agent orb.
 *
 * The shader and its state parameters are assistant-ui's voice orb, added with
 * `npx shadcn@latest add "@assistant-ui/voice"` (MIT, see orb-avatar.LICENSE) and
 * carried across unchanged. What is ours is the colour and the budget:
 *
 * - **Colour** comes from the agent's own `color`, through `orbStops`, rather
 *   than from the four fixed variants upstream ships. An agent is whatever
 *   colour it was given, and `ORB_PRESETS` is what it starts as.
 * - **Budget.** A browser allows a handful of live WebGL contexts and then
 *   starts dropping the oldest. A workspace rail can show twenty agents, so
 *   only orbs big enough to show the motion take a context, and only while
 *   they are on screen and motion is allowed. Everything else draws the same
 *   three stops as a still gradient, which is what the rail wants anyway.
 */
import { orbStops } from "@rakazo/core";
import { type CSSProperties, memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "./lib/utils.js";
import "./styles.css";

export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "muted";

type OrbParams = {
  speed: number;
  amplitude: number;
  glow: number;
  brightness: number;
  pulse: number;
  saturation: number;
};

const STATE_PARAMS: Record<OrbState, OrbParams> = {
  idle: { speed: 0.15, amplitude: 0.04, glow: 0.15, brightness: 0.55, pulse: 0, saturation: 0.7 },
  connecting: {
    speed: 0.5,
    amplitude: 0.1,
    glow: 0.45,
    brightness: 0.75,
    pulse: 1,
    saturation: 0.9,
  },
  listening: { speed: 0.4, amplitude: 0.14, glow: 0.5, brightness: 0.85, pulse: 0, saturation: 1 },
  speaking: { speed: 1.4, amplitude: 0.35, glow: 0.9, brightness: 1, pulse: 0, saturation: 1 },
  muted: {
    speed: 0.06,
    amplitude: 0.015,
    glow: 0.08,
    brightness: 0.35,
    pulse: 0,
    saturation: 0.2,
  },
};

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

const VERT_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform float u_speed;
uniform float u_amplitude;
uniform float u_glow;
uniform float u_brightness;
uniform float u_pulse;
uniform float u_saturation;
uniform vec3 u_color0;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float u_dpr;

// Simplex-like noise (3D)
vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x / 289.0) * 289.0; }
vec4 permute(vec4 x) { return mod289((x * 34.0 + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  vec3 i = floor(v + dot(v, vec3(C.y)));
  vec3 x0 = v - i + dot(i, vec3(C.x));
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g, l.zxy);
  vec3 i2 = max(g, l.zxy);
  vec3 x1 = x0 - i1 + C.x;
  vec3 x2 = x0 - i2 + C.y;
  vec3 x3 = x0 - 0.5;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  vec4 j = p - 49.0 * floor(p / 49.0);
  vec4 x_ = floor(j / 7.0);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = (x_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 y = (y_ * 2.0 + 0.5) / 7.0 - 1.0;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 g0 = vec3(a0.xy, h.x);
  vec3 g1 = vec3(a0.zw, h.y);
  vec3 g2 = vec3(a1.xy, h.z);
  vec3 g3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g0,g0), dot(g1,g1), dot(g2,g2), dot(g3,g3)));
  g0 *= norm.x; g1 *= norm.y; g2 *= norm.z; g3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(g0,x0), dot(g1,x1), dot(g2,x2), dot(g3,x3)));
}

void main() {
  vec2 uv = v_uv * 2.0 - 1.0;
  float dist = length(uv);
  float t = u_time * u_speed;

  // Perfect circle — hard boundary, soft anti-aliased edge
  float radius = 0.44;
  float circle = 1.0 - smoothstep(radius - 0.008, radius + 0.008, dist);

  if (circle < 0.001) {
    // Outer glow only
    float glowDist = dist - radius;
    float glow = exp(-glowDist * 12.0) * u_glow * 0.4;
    vec3 glowColor = mix(u_color0, u_color1, 0.5);
    fragColor = vec4(glowColor * glow, glow);
    return;
  }

  float n1 = snoise(vec3(uv * 2.0, t * 0.6)) * 0.5 + 0.5;
  float n2 = snoise(vec3(uv * 3.5 + 7.0, t * 0.9)) * 0.5 + 0.5;
  float n3 = snoise(vec3(uv * 1.5 - 3.0, t * 0.4 + 10.0)) * 0.5 + 0.5;

  vec2 distort = vec2(
    snoise(vec3(uv * 2.0 + 5.0, t * 0.7)),
    snoise(vec3(uv * 2.0 + 15.0, t * 0.7))
  ) * u_amplitude * 2.0;
  float n4 = snoise(vec3((uv + distort) * 3.0, t * 0.5)) * 0.5 + 0.5;

  vec3 col = mix(u_color0, u_color1, n1);
  col = mix(col, u_color2, n2 * 0.5);
  col = mix(col, u_color1 * 1.3, n4 * 0.4);

  float vein = pow(n3, 3.0) * u_amplitude * 6.0;
  col += vein * mix(u_color1, vec3(1.0), 0.3);

  float centerDist = dist / radius;
  float depthShade = 1.0 - centerDist * centerDist * 0.4;
  col *= depthShade;

  float rim = pow(centerDist, 4.0) * 0.6;
  col += rim * mix(u_color0, vec3(1.0), 0.5);

  vec2 lightPos = vec2(-0.15, -0.18);
  float specDist = length(uv - lightPos);
  float spec = exp(-specDist * specDist * 30.0) * 0.7;
  col += spec * vec3(1.0);

  vec2 lightPos2 = vec2(0.2, 0.25);
  float spec2 = exp(-length(uv - lightPos2) * 8.0) * 0.15;
  col += spec2 * u_color1;

  float pulseFactor = 1.0 + u_pulse * sin(u_time * 3.5) * 0.35;

  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, u_saturation);

  col *= u_brightness * pulseFactor;

  fragColor = vec4(col, circle);
}`;

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initWebGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
  });
  if (!gl) return null;

  const vs = createShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const uniforms = {
    u_time: gl.getUniformLocation(program, "u_time"),
    u_speed: gl.getUniformLocation(program, "u_speed"),
    u_amplitude: gl.getUniformLocation(program, "u_amplitude"),
    u_glow: gl.getUniformLocation(program, "u_glow"),
    u_brightness: gl.getUniformLocation(program, "u_brightness"),
    u_pulse: gl.getUniformLocation(program, "u_pulse"),
    u_saturation: gl.getUniformLocation(program, "u_saturation"),
    u_color0: gl.getUniformLocation(program, "u_color0"),
    u_color1: gl.getUniformLocation(program, "u_color1"),
    u_color2: gl.getUniformLocation(program, "u_color2"),
    u_dpr: gl.getUniformLocation(program, "u_dpr"),
  };

  return { gl, uniforms };
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
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
      // Only the still orb breathes: a live one already shows the run in its
      // own motion, and two signals at once reads as a glitch.
      data-working={!wantsLive && state === "speaking" ? "true" : undefined}
      className={cn("rakazo-orb relative inline-block shrink-0 rounded-full", className)}
      style={
        {
          width: size,
          height: size,
          "--rakazo-orb-halo": `color-mix(in oklab, ${mid} 45%, transparent)`,
        } as CSSProperties
      }
    >
      {/* The still orb is always drawn: it is what shows before the context is
          claimed, and what stays when there is none to claim. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle at 38% 32%, ${light} 0%, ${mid} 52%, ${dark} 100%)`,
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

function LiveOrb({ color, state, volume }: { color: string; state: OrbState; volume: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<ReturnType<typeof initWebGL>>(null);
  const frameRef = useRef(0);
  const startedAt = useRef(0);
  const volumeRef = useRef(0);
  volumeRef.current = volume;
  // Colour rides a ref into the render loop. Putting it in the effect's deps
  // tore the context down and rebuilt it on every change, and a canvas whose
  // context has been lost hands the same dead context back — which is a blank
  // white orb the moment someone picks a new colour.
  const colorRef = useRef(color);
  colorRef.current = color;
  const current = useRef<OrbParams>({ ...STATE_PARAMS.idle });
  const target = useRef<OrbParams>({ ...STATE_PARAMS.idle });
  useEffect(() => {
    target.current = { ...STATE_PARAMS[state] };
  }, [state]);

  // An orb off screen is not worth a context, and giving it up lets the next
  // one on screen take it.
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(Boolean(entry?.isIntersecting)),
      { rootMargin: "64px" },
    );
    observer.observe(canvas);
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
    if (!onScreen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!claimOrb()) return;

    const context = initWebGL(canvas);
    if (!context) {
      releaseOrb();
      return;
    }
    glRef.current = context;
    startedAt.current = performance.now();

    const render = () => {
      const ctx = glRef.current;
      const node = canvasRef.current;
      if (!ctx || !node) return;
      const { gl, uniforms } = ctx;
      const p = current.current;
      const t = target.current;
      const ease = 0.045;
      p.speed = lerp(p.speed, t.speed, ease);
      p.amplitude = lerp(p.amplitude, t.amplitude, ease);
      p.glow = lerp(p.glow, t.glow, ease);
      p.brightness = lerp(p.brightness, t.brightness, ease);
      p.pulse = lerp(p.pulse, t.pulse, ease);
      p.saturation = lerp(p.saturation, t.saturation, ease);

      const elapsed = (performance.now() - startedAt.current) / 1000;
      const dpr = window.devicePixelRatio || 1;
      const rect = node.getBoundingClientRect();
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      if (node.width !== width || node.height !== height) {
        node.width = width;
        node.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const level = volumeRef.current;
      const [midStop, lightStop, darkStop] = orbStops(colorRef.current);
      gl.uniform1f(uniforms.u_time, elapsed);
      gl.uniform1f(uniforms.u_speed, p.speed + level * 0.4);
      gl.uniform1f(uniforms.u_amplitude, p.amplitude + level * 0.12);
      gl.uniform1f(uniforms.u_glow, p.glow + level * 0.2);
      gl.uniform1f(uniforms.u_brightness, p.brightness);
      gl.uniform1f(uniforms.u_pulse, p.pulse);
      gl.uniform1f(uniforms.u_saturation, p.saturation);
      gl.uniform3fv(uniforms.u_color0, midStop);
      gl.uniform3fv(uniforms.u_color1, lightStop);
      gl.uniform3fv(uniforms.u_color2, darkStop);
      gl.uniform1f(uniforms.u_dpr, dpr);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frameRef.current);
      const ctx = glRef.current;
      glRef.current = null;
      ctx?.gl.getExtension("WEBGL_lose_context")?.loseContext();
      releaseOrb();
    };
    // budgetEpoch re-runs this when another orb gives its context back.
  }, [onScreen, budgetEpoch]);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full rounded-full" />;
}
