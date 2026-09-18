import {
  ArrowUp,
  ChevronDown,
  CircleDashed,
  Globe,
  Monitor,
  Plus,
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
  /**
   * Every row in the reference that names a third-party app carries that app's
   * own logo — Google Docs, Outlook, Teams — not a shape standing in for it.
   * `logo` is the URL the integration provider supplies, the same one the
   * integrations overlay already renders. When a row is about one of Cadre's
   * own surfaces instead (a Computer, a terminal, memory) there is no
   * third-party mark to show and `icon` is correct.
   */
  logo?: string;
  /** Shown when an app is named but its provider gave us no mark. */
  appName?: string;
  icon?: ReactNode;
  /** Plain text, with the destination emphasised — as in the reference. */
  text: string;
  target: string;
};

function SuggestionMark({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.logo) {
    return (
      <img
        src={suggestion.logo}
        alt=""
        width={16}
        height={16}
        className="size-4 shrink-0 rounded-[3px] object-contain"
      />
    );
  }
  if (suggestion.appName) {
    // A labelled tile, never an empty box: the row still reads as being about
    // that app when its provider has not given us a mark.
    return (
      <span
        aria-hidden
        className="grid size-4 shrink-0 place-items-center rounded-[3px] text-[8px] font-semibold uppercase"
        style={{ background: "var(--sana-hairline)", color: "var(--sana-fg-soft)" }}
      >
        {suggestion.appName.slice(0, 2)}
      </span>
    );
  }
  return <span className="shrink-0">{suggestion.icon}</span>;
}

export const CADRE_SUGGESTIONS: Suggestion[] = [
  // Cadre's own surfaces: no third-party mark exists for these, so they carry
  // Cadre's icons.
  {
    id: "resume",
    icon: <Zap size={15} style={{ color: "var(--sana-fg-soft)" }} />,
    text: "Pick up where",
    target: "yesterday's run",
  },
  {
    id: "computer",
    icon: <Monitor size={15} style={{ color: "var(--sana-fg-soft)" }} />,
    text: "Open a browser on the",
    target: "Team Computer",
  },
  {
    id: "terminal",
    icon: <Terminal size={15} style={{ color: "var(--sana-fg-soft)" }} />,
    text: "Run a build and report back from the",
    target: "terminal",
  },
  // Integration rows. `logo` is filled from the connected provider at runtime,
  // exactly as the integrations overlay does it; the tile is what shows until
  // then.
  { id: "gmail", appName: "Gmail", text: "Cut through the noise in", target: "Gmail" },
  { id: "slack", appName: "Slack", text: "Recap this morning in", target: "Slack" },
  {
    id: "connect",
    icon: <Globe size={15} style={{ color: "var(--sana-muted)" }} />,
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
                <SuggestionMark suggestion={suggestion} />
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
