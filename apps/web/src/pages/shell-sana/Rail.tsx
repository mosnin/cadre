import NumberFlow from "@number-flow/react";
import {
  Calendar,
  ChevronDown,
  Layers,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  Search,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import { BotName, type BotRunStatus } from "./BotName";
import { SHELL } from "./tokens";

/**
 * Left rail.
 *
 * Four stacked blocks, which is how the reference divides it: the workspace
 * switcher, the primary nav, one or more listed sections, then a footer pinned
 * to the bottom carrying usage and the primary action.
 *
 * Sana's nav reads New chat / Workflows / Search / Meetings / More. Cadre's
 * equivalents are its own: a schedule is a Schedule, a workflow's output lands
 * on a Computer, and the thing a person browses is their Workforce.
 */

type NavItem = {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number;
};

const NAV: NavItem[] = [
  { id: "new", label: "New chat", icon: <MessageSquarePlus size={SHELL.navIconSize} /> },
  { id: "schedules", label: "Schedules", icon: <Calendar size={SHELL.navIconSize} /> },
  { id: "search", label: "Search", icon: <Search size={SHELL.navIconSize} /> },
  { id: "computers", label: "Computers", icon: <Monitor size={SHELL.navIconSize} /> },
  { id: "more", label: "More", icon: <MoreHorizontal size={SHELL.navIconSize} /> },
];

export type RailBot = {
  id: string;
  name: string;
  status: BotRunStatus;
  runId?: string;
};

export function Rail({
  workspace,
  bots,
  conversations,
  activeNav = "new",
  messagesLeft,
  runsLeft,
}: {
  workspace: string;
  bots: RailBot[];
  conversations: { id: string; title: string }[];
  activeNav?: string;
  messagesLeft: number;
  runsLeft: number;
}) {
  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{ width: SHELL.railWidth, background: "var(--sana-rail)" }}
    >
      <button
        type="button"
        className="flex shrink-0 items-center gap-2 px-3 text-left"
        style={{ height: SHELL.workspaceHeight, fontSize: SHELL.navFontSize }}
      >
        <span className="grid size-5 shrink-0 place-items-center rounded-[4px] bg-neutral-900 text-[9px] font-semibold text-white">
          {workspace.slice(0, 2).toUpperCase()}
        </span>
        <span className="flex-1 truncate font-medium">{workspace}</span>
        <Layers size={13} style={{ color: "var(--sana-muted)" }} />
      </button>

      <nav className="px-2 pt-4">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 text-left"
            style={{
              height: SHELL.navPitch,
              fontSize: SHELL.navFontSize,
              background: item.id === activeNav ? "var(--sana-active)" : undefined,
              boxShadow: item.id === activeNav ? "var(--sana-active-shadow)" : undefined,
            }}
          >
            <span className="shrink-0" style={{ color: "var(--sana-fg-soft)" }}>
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      <Section label="Workforce">
        {bots.map((bot) => (
          <div
            key={bot.id}
            className="flex items-center gap-2.5 truncate rounded-md px-2.5"
            style={{ height: SHELL.navPitch, fontSize: SHELL.navFontSize }}
          >
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                bot.status === "working"
                  ? "bg-amber-500"
                  : bot.status === "needs-you"
                    ? "bg-rose-500"
                    : "bg-neutral-300"
              }`}
            />
            <BotName
              name={bot.name}
              status={bot.status}
              runId={bot.runId}
              restingColor="var(--sana-fg)"
              className="flex-1 truncate"
            />
          </div>
        ))}
      </Section>

      <Section label="Today">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className="flex items-center truncate rounded-md px-2.5"
            style={{
              height: SHELL.navPitch,
              fontSize: SHELL.navFontSize,
              color: "var(--sana-fg-soft)",
            }}
          >
            <span className="truncate">{conversation.title}</span>
          </div>
        ))}
      </Section>

      <div className="mt-auto px-3 pb-3">
        <div
          className="rounded-lg p-3"
          style={{ border: "1px solid var(--sana-hairline)", background: "var(--sana-active)" }}
        >
          <p className="text-[12px] leading-snug" style={{ color: "var(--sana-fg-soft)" }}>
            {/*
              Two counts that change as work runs. NumberFlow animates the digits
              so a number that drops while you are looking at it is legible as a
              change rather than a repaint. Seeded un-animated on mount by the
              adapter's own `willChange`/initial-value handling.
            */}
            <NumberFlow value={runsLeft} className="font-medium tabular-nums" /> runs and{" "}
            <NumberFlow value={messagesLeft} className="font-medium tabular-nums" /> messages left
            this month
          </p>
          <p className="pt-0.5 text-[11px]" style={{ color: "var(--sana-muted)" }}>
            Upgrade for unlimited use
          </p>
          <button
            type="button"
            className="mt-2.5 w-full rounded-md text-[12.5px] font-medium"
            style={{
              height: SHELL.primaryButtonHeight,
              background: "var(--sana-primary)",
              color: "var(--sana-primary-fg)",
            }}
          >
            Upgrade
          </button>
        </div>

        <button
          type="button"
          className="mt-2 flex w-full items-center gap-2.5 rounded-md px-2.5 text-left"
          style={{ height: SHELL.navPitch, fontSize: SHELL.navFontSize }}
        >
          <Settings size={SHELL.navIconSize} style={{ color: "var(--sana-fg-soft)" }} />
          <span className="flex-1">Settings</span>
          <ChevronDown size={13} style={{ color: "var(--sana-muted)" }} />
        </button>
      </div>
    </aside>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-2 pt-4">
      <p
        className="px-2.5 pb-1"
        style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}
