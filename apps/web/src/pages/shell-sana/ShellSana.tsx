import { useEffect } from "react";
import "./shell-sana.css";
import { textReveal06 } from "../../lib/text-reveal";
import { CADRE_SUGGESTIONS, Pane } from "./Pane";
import { Rail, type RailGroup } from "./Rail";

/**
 * The Sana-derived Cadre shell.
 *
 * Presentational only: it takes the workspace, the bots and the conversation
 * list as props so it can be measured against the reference on its own, and
 * wired to the live store separately. The existing Shell keeps running
 * untouched while this is brought to 1:1.
 */
export function ShellSana({
  workspace = "Personal",
  workspaceNote,
  groups,
  activeBotId,
  messagesLeft,
  runsLeft,
  user,
}: {
  workspace?: string;
  workspaceNote?: string;
  groups: RailGroup[];
  activeBotId?: string;
  messagesLeft: number;
  runsLeft: number;
  user: { name: string; initials: string };
}) {
  // Viewport-triggered reveals for anything below the fold. Completion-driven
  // sweeps do not go through here — BotName calls revealNow directly.
  useEffect(() => textReveal06(document), []);

  return (
    <div className="sana-shell flex h-full min-h-0 w-full">
      <Rail
        workspace={workspace}
        workspaceNote={workspaceNote}
        groups={groups}
        activeBotId={activeBotId}
        messagesLeft={messagesLeft}
        runsLeft={runsLeft}
        user={user}
      />
      <Pane agentName="All" suggestions={CADRE_SUGGESTIONS} />
    </div>
  );
}

/** Fixture used by the design route so the shell can be captured and diffed. */
export const SHELL_SANA_FIXTURE = {
  workspace: "Personal",
  workspaceNote: "Connect Company OS",
  activeBotId: "alfred",
  groups: [
    {
      id: "work",
      label: "Work",
      bots: [
        {
          id: "group-test",
          name: "Test group chat",
          status: "idle",
          color: "#E9C46A",
          preview: "The boss wants us to have a chat. So... how's it going?",
          at: "Sep 7",
        },
      ],
    },
    {
      id: "unassigned",
      label: "Unassigned",
      bots: [
        {
          id: "alfred",
          name: "Alfred",
          status: "done",
          runId: "r1",
          color: "#3FB68B",
          role: "Manager",
          preview: "Hey Preston! I'm on Amazon.com and it's fully loaded.",
          at: "7:44 PM",
        },
        {
          id: "jimmy",
          name: "Jimmy",
          status: "working",
          color: "#E9973F",
          preview: "Oh! I think I understand now - I've been overcomplicating this.",
          at: "Sep 7",
        },
        { id: "new-bot", name: "New Bot", status: "idle", color: "#6366F1", at: "Sep 7" },
      ],
    },
  ] satisfies RailGroup[],
  messagesLeft: 20,
  runsLeft: 7,
  user: { name: "Preston Wilms", initials: "PW" },
};
