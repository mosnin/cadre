import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@rakazo/ui-web";
import FluidOrb from "@rakazo/ui-web/components/ui/fluid-orb";
import type { ReactNode } from "react";

export function VoiceScreen({
  name,
  color,
  phase,
  level = 0,
  realtime,
  onClose,
  children,
}: {
  name: string;
  color: string;
  phase: string;
  level?: number;
  realtime?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="call-view"
        data-voice-transport={realtime ? "realtime" : "recorded"}
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-6 text-center text-foreground ring-0 sm:max-w-none sm:p-10 data-open:zoom-in-100 data-closed:zoom-out-100"
        style={{
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        <DialogHeader className="shrink-0 items-center">
          <DialogTitle className="text-lg font-medium">{name}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center" data-voice-phase={phase}>
          <div
            data-testid="voice-orb"
            data-audio-level={level.toFixed(2)}
            className="transition-transform duration-100 ease-out motion-reduce:transform-none motion-reduce:transition-none"
            style={{ transform: `scale(${1 + Math.min(1, Math.max(0, level)) * 0.065})` }}
          >
            <FluidOrb
              size={320}
              color={color}
              style={{ width: "min(68vw, 34dvh, 320px)", height: "min(68vw, 34dvh, 320px)" }}
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-lg shrink-0 flex-col items-center gap-4">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
