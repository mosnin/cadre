"use client";

import { cn } from "../../lib/utils";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

function FitScale({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      ref={ref}
      className="relative flex w-full justify-center overflow-hidden"
      style={{ height: (scale || 1) * height, visibility: scale ? "visible" : "hidden" }}
    >
      <div
        className="relative shrink-0"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          className="absolute top-0 left-0"
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const CARD =
  "bg-linear-to-b from-surface to-surface-soft shadow-[inset_0_0_0_1px_rgba(0,0,0,0.07),0_5px_14px_-12px_rgba(0,0,0,0.10)]";

const RULER_LEFT = 24;
const RULER_RIGHT = 496;
const TICK_COUNT = 42;
const TICK_STEP = (RULER_RIGHT - RULER_LEFT) / TICK_COUNT;
const tickX = (i: number) => RULER_LEFT + i * TICK_STEP;

const DAY_TICKS = 6;

const DAY_TICK_INDEXES = [0, 6, 12, 18, 24, 30, 36];

const PLAYHEAD_X = 428;

/* Geometry is fixed; the words come from the page so they can be localised.
   Colours match the bot roster further down the page. */
/* Rows are ~56px tall, so keep the tops far enough apart that a bar never
   covers the schedule line of the one above it. */
const ROW_GEOMETRY = [
  { left: 36, width: 262, top: 76, color: "#6A6BF5" },
  { left: 150, width: 268, top: 144, color: "#F5A03C" },
  { left: 84, width: 240, top: 212, color: "#3EC5A8" },
];

export type RoutineRow = {
  title: string;
  range: string;
};

export type TimelineProps = {
  rows: RoutineRow[];
  dayLabels: string[];
  nowLabel: string;
};

function BotDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full ring-2 ring-surface"
      style={{ background: color }}
    />
  );
}

const Timeline = ({ rows, dayLabels, nowLabel }: TimelineProps) => {
  const playX = PLAYHEAD_X;
  const laid = ROW_GEOMETRY.map((g, i) => ({ ...g, ...rows[i] })).filter((r) => r.title);

  return (
    <FitScale width={520} height={300}>
      <div className="relative h-full w-full overflow-hidden">
        <div
          className="absolute h-px bg-line-2"
          style={{ left: RULER_LEFT, right: 520 - RULER_RIGHT, top: 60 }}
        />

        {Array.from({ length: TICK_COUNT + 1 }).map((_, i) => {
          const major = i % DAY_TICKS === 0;
          return (
            <div
              key={i}
              className="absolute w-px bg-line-2"
              style={{
                left: tickX(i),
                top: major ? 52 : 55,
                height: major ? 8 : 5,
              }}
            />
          );
        })}

        {DAY_TICK_INDEXES.map((tick, i) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 text-[9px] font-semibold tracking-wide text-muted tabular-nums"
            style={{ left: tickX(tick), top: 32 }}
          >
            {dayLabels[i]}
          </span>
        ))}

        {laid.map((r) => (
          <div
            key={r.title}
            className={cn(
              "absolute z-10 flex items-center justify-between gap-4 rounded-xl px-4 py-2.5",
              CARD,
            )}
            style={{ left: r.left, top: r.top, width: r.width }}
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium tracking-tight text-ink">
                {r.title}
              </p>
              <p className="mt-0.5 text-[10px] font-medium text-muted tabular-nums">
                {r.range}
              </p>
            </div>

            <BotDot color={r.color} />
          </div>
        ))}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20 w-12 -translate-x-1/2 bg-brand/5 blur-2xl"
          style={{ left: playX, top: 34, bottom: 0 }}
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-30 w-px bg-brand/60"
          style={{ left: playX, top: 28, bottom: 0 }}
        />

        <div
          className="absolute z-40 -translate-x-1/2 rounded-md bg-linear-to-b from-[var(--blue-top)] to-[var(--blue)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white shadow-[0_4px_10px_-3px_rgba(41,101,236,0.35)]"
          style={{ left: playX, top: 6 }}
        >
          {nowLabel}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-50 w-10 bg-linear-to-r from-page to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-50 w-8 bg-linear-to-l from-page to-transparent"
        />
      </div>
    </FitScale>
  );
};

export default Timeline;
