import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { OpenAIRealtimeCall, type RealtimePhase } from "../lib/adapters/openai-realtime";
import { pendingSecretAsk } from "../lib/call-task";
import { withSpaceHeaders } from "../lib/rpc";
import type { CallProps } from "./CallView";
import { VoiceScreen } from "./VoiceScreen";

export function RealtimeCallView(props: CallProps) {
  const { t } = useLingui();
  const current = useRef(props);
  current.current = props;
  const call = useRef<OpenAIRealtimeCall | null>(null);
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<RealtimePhase>("connecting");
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const watched = useRef(new Set<string>());
  const updates = useRef(new Map<string, string>());
  const secret = pendingSecretAsk(props.snapshot);
  async function execute(name: string, args: unknown, callId: string) {
    const response = await fetch("/api/voice/tool", {
      method: "POST",
      credentials: "include",
      headers: withSpaceHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ botId: current.current.botId, name, args, callId }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Voice action failed.");
    if (result.accepted && result.agentId) {
      watched.current.add(result.agentId);
      if (name === "spawn_agent") void current.current.onAgentsChanged?.().catch(() => undefined);
      updates.current.set(result.agentId, "accepted");
    }
    return result;
  }
  useEffect(() => {
    setError(null);
    setLevel(0);
    setCaption("");
    setHeard("");
    watched.current = new Set([props.botId]);
    updates.current.clear();
    const session = new OpenAIRealtimeCall({
      phase: setPhase,
      level: setLevel,
      heard: setHeard,
      caption: (text) => setCaption((previous) => (text ? previous + text : "")),
      error: setError,
      tool: execute,
    });
    call.current = session;
    session.setInputEnabled(!pendingSecretAsk(current.current.snapshot));
    void session.connect(props.botId);
    return () => {
      session.close();
      if (call.current === session) call.current = null;
    };
  }, [props.botId, attempt]);

  useEffect(() => {
    call.current?.setInputEnabled(!secret);
    if (secret) setHeard("");
  }, [secret]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      for (const agentId of watched.current) {
        if (disposed) return;
        try {
          const result = await execute("task_status", { agentId }, crypto.randomUUID());
          if (disposed) return;
          const key = JSON.stringify(result);
          const previous = updates.current.get(agentId);
          updates.current.set(agentId, key);
          if (
            previous &&
            previous !== key &&
            !["queued", "running", "leased"].includes(result.status)
          )
            call.current?.taskUpdate(key);
        } catch {
          /* Reconnect/status tools surface errors; a poll does not end the call. */
        }
      }
      if (!disposed) timer = setTimeout(() => void poll(), 4000);
    };
    timer = setTimeout(() => void poll(), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [props.botId, attempt]);

  function hangUp() {
    call.current?.close();
    props.onClose();
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hangUp();
      } else if (event.key === " ") {
        event.preventDefault();
        call.current?.interrupt();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <VoiceScreen
      name={props.botName}
      color={props.botColor}
      phase={phase}
      level={secret ? 0 : level}
      realtime
      onClose={hangUp}
    >
      <div role="status" className="mt-1 text-[15px] text-foreground/75">
        {phase === "connecting"
          ? t`Connecting…`
          : phase === "speaking"
            ? t`Speaking…`
            : phase === "thinking"
              ? t`Thinking…`
              : t`Listening…`}
      </div>
      <p className="max-h-[18dvh] min-h-[3.2em] w-full overflow-y-auto text-[14.5px] leading-[1.5] text-muted-foreground">
        {secret ? t`Enter the code on screen. Your microphone is muted.` : caption || heard}
      </p>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {error ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                call.current?.close();
                setAttempt((value) => value + 1);
              }}
            >
              <Trans>Reconnect</Trans>
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void call.current
                  ?.resumeAudio()
                  .then(() => setError(null))
                  .catch(() => setError(t`Audio could not resume.`))
              }
            >
              <Trans>Resume audio</Trans>
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            className="h-12 rounded-full px-6"
            onClick={() => call.current?.interrupt()}
          >
            <Trans>Interrupt</Trans>
          </Button>
        )}
        <Button variant="destructive" className="h-12 rounded-full px-6" onClick={hangUp}>
          <Trans>Hang up</Trans>
        </Button>
      </div>
    </VoiceScreen>
  );
}
