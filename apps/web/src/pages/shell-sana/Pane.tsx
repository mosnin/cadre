import {
  ArrowUp,
  ChevronDown,
  CircleDashed,
  Globe,
  Monitor,
  Plus,
  Sparkles,
  Terminal,
  UserPlus,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { SHELL } from "./tokens";

/**
 * Main pane.
 *
 * The reference has almost no chrome: a thin header with an agent picker at the
 * left and two plain actions at the right, then a single centred column holding
 * the composer and a hairline-separated suggestion list. No card, no panel, no
 * border around the column — the separators are the only rules on the screen,
 * and the composer is centred on the pane rather than on the window.
 */

export type Suggestion = {
  id: string;
  icon: ReactNode;
  /** Plain text, with the destination emphasised — as in the reference. */
  text: string;
  target: string;
};

export const CADRE_SUGGESTIONS: Suggestion[] = [
  {
    id: "brief",
    icon: <Zap size={15} className="text-amber-500" />,
    text: "Pick up where",
    target: "yesterday's run",
  },
  {
    id: "computer",
    icon: <Monitor size={15} className="text-sky-600" />,
    text: "Open a browser on the",
    target: "Team Computer",
  },
  {
    id: "terminal",
    icon: <Terminal size={15} className="text-neutral-700" />,
    text: "Run a build and report back from the",
    target: "terminal",
  },
  {
    id: "schedule",
    icon: <CircleDashed size={15} className="text-violet-500" />,
    text: "Turn this into a",
    target: "recurring schedule",
  },
  {
    id: "memory",
    icon: <Sparkles size={15} className="text-rose-500" />,
    text: "Remember this for next time in",
    target: "memory",
  },
  {
    id: "connect",
    icon: <Globe size={15} className="text-neutral-400" />,
    text: "Connect your apps for better answers",
    target: "",
  },
];

export function Pane({ agentName, suggestions }: { agentName: string; suggestions: Suggestion[] }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col" style={{ background: "var(--sana-pane)" }}>
      <header className="flex h-12 shrink-0 items-center px-4">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13.5px] font-medium"
        >
          {agentName}
          <ChevronDown size={13} style={{ color: "var(--sana-muted)" }} />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px]"
            style={{ border: "1px solid var(--sana-hairline)" }}
          >
            <UserPlus size={13} style={{ color: "var(--sana-fg-soft)" }} />
            Invite
          </button>
          <button type="button" className="rounded-md px-2.5 py-1 text-[12.5px]">
            Help
          </button>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-end px-6"
        style={{ paddingBottom: SHELL.columnBottomGap }}
      >
        <div style={{ width: SHELL.composerWidth, maxWidth: "100%" }}>
          <div
            className="flex items-center gap-2.5 rounded-[18px] px-4"
            style={{ height: SHELL.composerHeight, background: "var(--sana-composer)" }}
          >
            <Zap size={16} className="shrink-0" style={{ color: "var(--sana-muted)" }} />
            <span
              className="flex-1 truncate"
              style={{ fontSize: SHELL.composerFontSize, color: "var(--sana-muted)" }}
            >
              What would you like to do?
            </span>
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full"
              style={{ background: "var(--sana-hairline)" }}
            >
              <ArrowUp size={14} style={{ color: "var(--sana-fg-soft)" }} />
            </span>
          </div>

          <div
            className="flex items-center gap-4 px-1 text-[12.5px]"
            style={{ height: SHELL.metaRowHeight, color: "var(--sana-fg-soft)" }}
          >
            <button type="button" className="flex items-center gap-1.5">
              <Plus size={13} /> Create
            </button>
            <button type="button" className="flex items-center gap-1.5">
              <Plus size={13} /> Sources
            </button>
            <button type="button" className="ml-auto flex items-center gap-1.5">
              <CircleDashed size={13} /> Default
            </button>
          </div>

          <ul style={{ paddingTop: SHELL.listGap }}>
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.id}
                className="flex items-center gap-3 border-t px-1"
                style={{
                  height: SHELL.suggestionPitch,
                  fontSize: SHELL.suggestionFontSize,
                  borderColor: "var(--sana-hairline)",
                }}
              >
                <span className="shrink-0">{suggestion.icon}</span>
                <span className="truncate" style={{ color: "var(--sana-fg-soft)" }}>
                  {suggestion.text}
                  {suggestion.target ? (
                    <span className="font-medium" style={{ color: "var(--sana-fg)" }}>
                      {" "}
                      {suggestion.target}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
