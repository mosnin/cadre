import NumberFlow from "@number-flow/react";
import { BotAvatar } from "@rakazo/ui-web";
import {
  Calendar,
  ChevronDown,
  Library,
  MessageSquarePlus,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { BotName, type BotRunStatus } from "./BotName";
import { SHELL } from "./tokens";

/**
 * Left rail.
 *
 * Sana's geometry, Cadre's contents. The reference stacks a workspace switcher,
 * a primary nav, listed sections and a pinned footer; what goes in those slots
 * is what the current Cadre rail already controls — the workspace and its
 * subtitle, a search field, Conversations and Activity, collapsible groups of
 * bots, the workspace library and the signed-in person.
 *
 * The bot rows keep what the current rail gets right and the reference has no
 * equivalent for: the real organic avatar, the bot's role, its last line and
 * when it spoke. A bot has to be recognisable at a glance from this list.
 */

type NavItem = { id: string; label: string; icon: ReactNode };

const NAV: NavItem[] = [
  { id: "new", label: "New chat", icon: <MessageSquarePlus size={SHELL.navIconSize} /> },
  { id: "schedules", label: "Schedules", icon: <Calendar size={SHELL.navIconSize} /> },
  { id: "computers", label: "Computers", icon: <Monitor size={SHELL.navIconSize} /> },
  { id: "more", label: "More", icon: <MoreHorizontal size={SHELL.navIconSize} /> },
];

export type RailBot = {
  id: string;
  name: string;
  status: BotRunStatus;
  runId?: string;
  /** The bot's own colour, which its avatar is generated from. */
  color: string;
  role?: string;
  preview?: string;
  at?: string;
};

export type RailGroup = {
  id: string;
  label: string;
  bots: RailBot[];
};

export function Rail({
  workspace,
  workspaceNote,
  groups,
  activeNav = "new",
  activeBotId,
  messagesLeft,
  runsLeft,
  user,
}: {
  workspace: string;
  workspaceNote?: string;
  groups: RailGroup[];
  activeNav?: string;
  activeBotId?: string;
  messagesLeft: number;
  runsLeft: number;
  user: { name: string; initials: string };
}) {
  const [tab, setTab] = useState<"conversations" | "activity">("conversations");

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{ width: SHELL.railWidth, background: "var(--sana-rail)" }}
    >
      <div
        className="flex shrink-0 items-center gap-2 px-3"
        style={{ height: SHELL.workspaceHeight }}
      >
        <span className="min-w-0 flex-1">
          <span
            className="flex items-center gap-1 truncate font-medium"
            style={{ fontSize: SHELL.navFontSize }}
          >
            {workspace}
            <ChevronDown size={13} style={{ color: "var(--sana-muted)" }} />
          </span>
          {workspaceNote ? (
            <span
              className="block truncate"
              style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}
            >
              {workspaceNote}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          aria-label="Create"
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{ color: "var(--sana-fg-soft)" }}
        >
          <Plus size={15} />
        </button>
      </div>

      <div className="px-2 pb-2">
        <div
          className="flex items-center gap-2 rounded-lg px-2.5"
          style={{ height: 32, background: "var(--sana-active)" }}
        >
          <Search size={13} style={{ color: "var(--sana-muted)" }} />
          <span style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}>
            Search
          </span>
        </div>
      </div>

      <nav className="px-2">
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

      {/* Conversations and Activity are two ways into the same bots, which is
          how the current rail already splits them. */}
      <div
        className="mt-3 flex gap-4 px-4"
        style={{ borderBottom: "1px solid var(--sana-hairline)" }}
      >
        {(["conversations", "activity"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="-mb-px pb-2 capitalize"
            style={{
              fontSize: SHELL.sectionFontSize,
              color: tab === id ? "var(--sana-fg)" : "var(--sana-muted)",
              borderBottom: `1px solid ${tab === id ? "var(--sana-fg)" : "transparent"}`,
            }}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
        {groups.map((group) => (
          <Group key={group.id} label={group.label}>
            {group.bots.map((bot) => (
              <BotRow key={bot.id} bot={bot} active={bot.id === activeBotId} />
            ))}
          </Group>
        ))}
      </div>

      <div className="shrink-0 px-3 pb-3">
        <div
          className="rounded-lg p-3"
          style={{
            border: "1px solid var(--sana-hairline)",
            background: "var(--sana-active)",
          }}
        >
          <p className="text-[12px] leading-snug" style={{ color: "var(--sana-fg-soft)" }}>
            {/* NumberFlow so a count that drops while you are looking at it
                reads as a change rather than a repaint. */}
            <NumberFlow value={runsLeft} className="font-medium tabular-nums" /> runs and{" "}
            <NumberFlow value={messagesLeft} className="font-medium tabular-nums" /> messages left
            this month
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
          <Library size={SHELL.navIconSize} style={{ color: "var(--sana-fg-soft)" }} />
          <span className="flex-1 truncate">Workspace library</span>
        </button>

        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 text-left"
          style={{ height: SHELL.navPitch, fontSize: SHELL.navFontSize }}
        >
          <span
            className="grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold"
            style={{ background: "var(--sana-hairline)", color: "var(--sana-fg-soft)" }}
          >
            {user.initials}
          </span>
          <span className="flex-1 truncate">{user.name}</span>
          <Settings size={13} style={{ color: "var(--sana-muted)" }} />
        </button>
      </div>
    </aside>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pb-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
        style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}
      >
        {label}
        <ChevronDown
          size={12}
          style={{
            transform: open ? undefined : "rotate(-90deg)",
            transition: "transform 120ms",
          }}
        />
      </button>
      {open ? children : null}
    </div>
  );
}

function BotRow({ bot, active }: { bot: RailBot; active?: boolean }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2"
      style={{ background: active ? "var(--sana-active)" : undefined }}
    >
      <BotAvatar
        color={bot.color}
        identity={bot.id}
        size={SHELL.botAvatarSize}
        status={bot.status === "working" ? "running" : undefined}
        className="mt-0.5 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <BotName
            name={bot.name}
            status={bot.status}
            runId={bot.runId}
            restingColor="var(--sana-fg)"
            className="truncate font-medium"
          />
          {bot.at ? (
            <span
              className="ml-auto shrink-0"
              style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}
            >
              {bot.at}
            </span>
          ) : null}
        </span>
        {bot.role ? (
          <span
            className="block truncate"
            style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-fg-soft)" }}
          >
            {bot.role}
          </span>
        ) : null}
        {bot.preview ? (
          <span
            className="block truncate"
            style={{ fontSize: SHELL.sectionFontSize, color: "var(--sana-muted)" }}
          >
            {bot.preview}
          </span>
        ) : null}
      </span>
    </div>
  );
}
