"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuCheck, LuLockKeyhole } from "react-icons/lu";

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

export type Approval = {
  label: string;
  /* true = the bot stopped and asked instead of acting on its own. */
  asks?: boolean;
};

export type ApprovalListProps = {
  approvals: Approval[];
  doneLabel: string;
  asksLabel: string;
};

const HandoffMenu = ({ approvals, doneLabel, asksLabel }: ApprovalListProps) => {
  return (
    <FitScale width={470} height={300}>
      <div className="relative h-full w-full">
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5">
          {approvals.map((a) => (
            <div
              key={a.label}
              className="flex h-12 w-110 items-center gap-3 rounded-xl bg-black/3 px-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]"
            >
              {a.asks ? (
                <LuLockKeyhole className="size-4 shrink-0 text-brand" />
              ) : (
                <LuCheck className="size-4 shrink-0 text-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-[14px] text-body">
                {a.label}
              </span>
              <span
                className={
                  a.asks
                    ? "shrink-0 rounded-md bg-brand-soft px-2 py-0.5 text-[10px] font-semibold tracking-wide text-brand"
                    : "shrink-0 text-[10px] font-semibold tracking-wide text-muted"
                }
              >
                {a.asks ? asksLabel : doneLabel}
              </span>
            </div>
          ))}
        </div>

      </div>
    </FitScale>
  );
};

export default HandoffMenu;
