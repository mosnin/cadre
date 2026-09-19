import { orbColors, orbSeed } from "@cadre/core";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@cadre/ui-web";
import { type AgentState, Orb } from "@cadre/ui-web/components/ui/orb";
import type { ReactNode } from "react";

function agentStateForPhase(phase: string): AgentState {
  if (phase === "listening") return "listening";
  if (phase === "speaking") return "talking";
  if (phase === "thinking" || phase === "connecting") return "thinking";
  return null;
}

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
            className="pointer-events-none aspect-square h-full max-h-full w-full max-w-full overflow-hidden"
          >
            <Orb
              className="h-full w-full"
              colors={orbColors(color)}
              seed={orbSeed(color)}
              agentState={agentStateForPhase(phase)}
              volumeMode="manual"
              getInputVolume={() => (phase === "listening" ? Math.min(1, Math.max(0, level)) : 0)}
              getOutputVolume={() => Math.min(1, Math.max(0, level))}
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
