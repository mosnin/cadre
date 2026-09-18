import { useEffect } from "react";
import "./shell-sana.css";
import { textReveal06 } from "../../lib/text-reveal";
import { CADRE_SUGGESTIONS, Pane } from "./Pane";
import { Rail, type RailBot } from "./Rail";

/**
 * The Sana-derived Cadre shell.
 *
 * Presentational only: it takes the workspace, the bots and the conversation
 * list as props so it can be measured against the reference on its own, and
 * wired to the live store separately. The existing Shell keeps running
 * untouched while this is brought to 1:1.
 */
export function ShellSana({
  workspace = "Cadre",
  bots,
  conversations,
  messagesLeft,
  runsLeft,
}: {
  workspace?: string;
  bots: RailBot[];
  conversations: { id: string; title: string }[];
  messagesLeft: number;
  runsLeft: number;
}) {
  // Viewport-triggered reveals for anything below the fold. Completion-driven
  // sweeps do not go through here — BotName calls revealNow directly.
  useEffect(() => textReveal06(document), []);

  return (
    <div className="sana-shell flex h-full min-h-0 w-full">
      <Rail
        workspace={workspace}
        bots={bots}
        conversations={conversations}
        messagesLeft={messagesLeft}
        runsLeft={runsLeft}
      />
      <Pane agentName="All" suggestions={CADRE_SUGGESTIONS} />
    </div>
  );
}

/** Fixture used by the design route so the shell can be captured and diffed. */
export const SHELL_SANA_FIXTURE = {
  workspace: "Cadre",
  bots: [
    { id: "b1", name: "Atlas", status: "done", runId: "r1" },
    { id: "b2", name: "Beacon", status: "working" },
    { id: "b3", name: "Ferry", status: "needs-you" },
  ] satisfies RailBot[],
  conversations: [
    { id: "c1", title: "Kickoff follow-up tasks" },
    { id: "c2", title: "Nightly dependency sweep" },
  ],
  messagesLeft: 20,
  runsLeft: 7,
};
