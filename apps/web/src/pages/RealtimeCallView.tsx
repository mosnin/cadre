import { Trans, useLingui } from "@lingui/react/macro";
import { speechFromBlocks, spokenDecision } from "@rakazo/core";
import { Button } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { OpenAIRealtimeCall, type RealtimePhase } from "../lib/adapters/openai-realtime";
import { hasWorkingRun, latestAskId, pendingSecretAsk } from "../lib/call-task";
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
  const reported = useRef<string | null>(null);
  const dispatching = useRef(false);
  const secret = pendingSecretAsk(props.snapshot);

  function status() {
    const snapshot = current.current.snapshot;
    if (pendingSecretAsk(snapshot))
      return {
        status: "waiting_input",
        message: "Enter the secret using the protected on-screen input. Do not say it aloud.",
      };
    const latest = [...(snapshot?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "bot");
    return {
      status: snapshot?.run?.status ?? (hasWorkingRun(snapshot) ? "running" : "idle"),
      message: latest
        ? speechFromBlocks(
            latest.blocks.filter((block) => block.kind !== "progress" && block.kind !== "meta"),
          )
        : "No task result yet.",
    };
  }
  useEffect(() => {
    setError(null);
    setLevel(0);
    setCaption("");
    setHeard("");
    reported.current =
      [...(current.current.snapshot?.messages ?? [])]
        .reverse()
        .find((message) => message.role === "bot")?.id ?? null;
    const session = new OpenAIRealtimeCall({
      phase: setPhase,
      level: setLevel,
      heard: setHeard,
      caption: (text) => setCaption((previous) => (text ? previous + text : "")),
      error: setError,
      tool: async (name, args) => {
        if (name === "task_status") return status();
        const request = (args as { request?: unknown })?.request;
        if (typeof request !== "string" || !request.trim() || request.length > 32000)
          throw new Error("A clear task request is required.");
        if (pendingSecretAsk(current.current.snapshot))
          throw new Error("Enter the secret using the protected on-screen input.");
        if (dispatching.current)
          throw new Error("A request is already being sent. Check task status before retrying.");
        dispatching.current = true;
        try {
          const value = current.current;
          const askId = latestAskId(value.snapshot);
          const ask = value.snapshot?.messages.find((message) => message.id === askId);
          if (ask) await value.onAnswer(ask, spokenDecision(request) ?? request);
          else if (hasWorkingRun(value.snapshot)) await value.onFollowUp(request);
          else await value.onSend(request);
          return {
            accepted: true,
            message:
              "Request accepted by the agent. Execution is not yet confirmed complete; wait for task updates.",
          };
        } finally {
          dispatching.current = false;
        }
      },
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
    const latest = [...(props.snapshot?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "bot");
    if (!latest || latest.id === reported.current || phase === "connecting") return;
    const ask = latest.blocks.some((block) => block.kind === "ask" && block.status !== "answered");
    if (hasWorkingRun(props.snapshot) && !ask) return;
    reported.current = latest.id;
    call.current?.taskUpdate(JSON.stringify(status()));
  }, [props.snapshot, phase, secret]);

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
