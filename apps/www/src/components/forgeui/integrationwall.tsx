"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FaSlack } from "react-icons/fa6";
import {
  SiAirtable,
  SiAsana,
  SiCalendly,
  SiClickup,
  SiDiscord,
  SiDropbox,
  SiFigma,
  SiGithub,
  SiGmail,
  SiGooglecalendar,
  SiGoogledrive,
  SiGooglesheets,
  SiHubspot,
  SiIntercom,
  SiJira,
  SiLinear,
  SiNotion,
  SiShopify,
  SiStripe,
  SiTrello,
  SiTypeform,
  SiZendesk,
  SiZoom,
} from "react-icons/si";

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

type App = {
  Icon?: React.ComponentType<{ className?: string }>;
};

const APPS: App[] = [
  { Icon: SiGmail },
  { Icon: FaSlack },
  { Icon: SiNotion },
  { Icon: SiLinear },
  { Icon: SiGithub },
  { Icon: SiGooglecalendar },
  { Icon: SiHubspot },
  { Icon: SiStripe },
  { Icon: SiJira },
  { Icon: SiAsana },
  { Icon: SiTrello },
  { Icon: SiZoom },
  { Icon: SiAirtable },
  { Icon: SiDiscord },
  { Icon: SiDropbox },
  { Icon: SiGoogledrive },
  { Icon: SiGooglesheets },
  { Icon: SiIntercom },
  { Icon: SiZendesk },
  { Icon: SiShopify },
  { Icon: SiClickup },
  { Icon: SiCalendly },
  { Icon: SiTypeform },
  { Icon: SiFigma },
];

const IntegrationWall = () => {
  return (
    <FitScale width={460} height={300}>
      <div className="relative h-full w-full overflow-hidden">
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ perspective: "1400px" }}
        >
          <div
            className="grid grid-cols-6 gap-4"
            style={{ transform: "rotateX(36deg) rotateZ(12deg) scale(1.02)" }}
          >
            {APPS.map((a, i) => {
              const Icon = a.Icon;
              return (
                <div
                  key={i}
                  className="flex size-16 items-center justify-center rounded-2xl bg-linear-to-b from-surface to-surface-soft shadow-[inset_0_1px_0_rgba(255,255,255,0.7),inset_0_0_0_1px_rgba(0,0,0,0.07),0_18px_22px_-8px_rgba(0,0,0,0.07)]"
                >
                  {Icon && <Icon className="size-7 text-ink/75" />}
                </div>
              );
            })}
          </div>
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-[linear-gradient(to_bottom,var(--page),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-[linear-gradient(to_top,var(--page),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-[linear-gradient(to_right,var(--page),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-[linear-gradient(to_left,var(--page),transparent)]"
        />
      </div>
    </FitScale>
  );
};

export default IntegrationWall;
