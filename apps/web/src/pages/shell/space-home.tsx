import type { Bot } from "@cadre/contracts";
import { conversationPreview } from "@cadre/core";
import { BotAvatar } from "@cadre/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowUp, CalendarClock, CircleDashed, Globe, Monitor, Plus, Zap } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { HOME } from "./home-tokens";

/**
 * The workspace home: what the pane shows before a conversation is open.
 *
 * One centred column, bottom-anchored, holding the composer and a
 * hairline-separated list of the things worth doing next. No card, no panel,
 * no border around the column — the separators are the only rules on the
 * screen. Geometry is in `home-tokens.ts`.
 *
 * Every row here goes somewhere real. The bot rows carry the bot's own
 * generated avatar and its last line, so the list is recognisable at a glance
 * rather than a set of identical shapes.
 */

type Row = {
  id: string;
  mark: ReactNode;
  /** One line, with the thing it acts on emphasised — as in the reference. */
  label: ReactNode;
  onSelect: () => void;
};

/** The emphasised span inside a row's sentence. */
function Strong({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

export function SpaceHome({
  bots,
  draftTarget,
  onSend,
  onOpenBot,
  onCreateBot,
  onResumeSetup,
  onOpenIntegrations,
  onOpenSchedules,
  onOpenComputer,
  modelLabel,
}: {
  bots: Bot[];
  /** The bot a message typed here is addressed to; absent until one exists. */
  draftTarget: Bot | undefined;
  onSend: (text: string) => void;
  onOpenBot: (id: string) => void;
  onCreateBot: () => void;
  /** Reopens the setup flow. The only way back into it once it is closed. */
  onResumeSetup: () => void;
  onOpenIntegrations: () => void;
  onOpenSchedules: () => void;
  onOpenComputer: (botId: string) => void;
  modelLabel: string;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState("");
  const reducedMotion = useReducedMotion();

  const recent = bots.slice(0, 3);
  const rows: Row[] = recent.map((bot) => {
    const line = bot.preview?.trim() ? conversationPreview(bot.preview) : "";
    return {
      id: bot.id,
      mark: (
        <BotAvatar
          color={bot.color}
          identity={bot.id}
          size={HOME.suggestionAvatarSize}
          status={bot.status}
        />
      ),
      label: line ? (
        <>
          <Strong>{bot.name}</Strong>
          {" — "}
          {line}
        </>
      ) : (
        <>
          {t`Start a conversation with`} <Strong>{bot.name}</Strong>
        </>
      ),
      onSelect: () => onOpenBot(bot.id),
    };
  });

  if (draftTarget) {
    rows.push({
      id: "computer",
      mark: <Monitor size={HOME.suggestionIconSize} className="text-muted-foreground" />,
      label: (
        <>
          {t`Open a browser on`} <Strong>{t`${draftTarget.name}'s computer`}</Strong>
        </>
      ),
      onSelect: () => onOpenComputer(draftTarget.id),
    });
    rows.push({
      id: "schedule",
      mark: <CalendarClock size={HOME.suggestionIconSize} className="text-muted-foreground" />,
      label: (
        <>
          {t`Have it run on a schedule with`} <Strong>{t`Routines`}</Strong>
        </>
      ),
      onSelect: onOpenSchedules,
    });
  } else {
    // A workspace with no agent is a workspace part-way through setup, so
    // this row resumes the setup flow rather than opening the bare create
    // panel. Closing setup used to strand you: the flow had no other
    // entrance, and the screen that used to offer "Continue setup" is the
    // one this home replaced.
    rows.push({
      id: "create",
      mark: <Plus size={HOME.suggestionIconSize} className="text-muted-foreground" />,
      label: (
        <>
          {t`Start with your`} <Strong>{t`first bot`}</Strong>
        </>
      ),
      onSelect: onResumeSetup,
    });
  }

  rows.push({
    id: "connect",
    mark: <Globe size={HOME.suggestionIconSize} className="text-muted-foreground/70" />,
    label: t`Connect your apps for better answers`,
    onSelect: onOpenIntegrations,
  });

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend(text);
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-end px-4 md:px-6"
      style={{ paddingBottom: HOME.columnBottomGap }}
    >
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
        style={{ maxWidth: HOME.columnWidth }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex items-center gap-2.5 bg-card px-4 py-3"
          style={{ minHeight: HOME.composerHeight, borderRadius: HOME.composerRadius }}
        >
          <Zap size={16} className="shrink-0 self-start text-muted-foreground/70" />
          <label className="sr-only" htmlFor="workspace-home-composer">
            <Trans>What would you like to do?</Trans>
          </label>
          <textarea
            id="workspace-home-composer"
            data-testid="home-composer"
            value={draft}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t`What would you like to do?`}
            className="min-w-0 flex-1 resize-none bg-transparent placeholder:text-muted-foreground/70 focus:outline-none"
            style={{ fontSize: HOME.composerFontSize, lineHeight: 1.45 }}
          />
          <button
            type="submit"
            aria-label={t`Send`}
            disabled={draft.trim().length === 0}
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:bg-accent disabled:text-muted-foreground"
          >
            <ArrowUp size={14} />
          </button>
        </form>

        <div
          className="flex items-center gap-4 px-1 text-muted-foreground"
          style={{ height: HOME.metaRowHeight, fontSize: HOME.metaFontSize }}
        >
          <button
            type="button"
            onClick={onCreateBot}
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Plus size={13} />
            <Trans>Create</Trans>
          </button>
          <button
            type="button"
            onClick={onOpenIntegrations}
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <Plus size={13} />
            <Trans>Sources</Trans>
          </button>
          <span className="ms-auto flex items-center gap-1.5">
            <CircleDashed size={13} />
            {modelLabel}
          </span>
        </div>

        <ul style={{ paddingTop: HOME.listGap }}>
          {rows.map((row, index) => (
            <motion.li
              key={row.id}
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.32,
                delay: reducedMotion ? 0 : 0.06 + index * 0.045,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="border-t border-sidebar-border"
            >
              <button
                type="button"
                onClick={row.onSelect}
                className="flex w-full items-center gap-3 rounded-lg px-1 text-start hover:bg-accent/60"
                style={{ height: HOME.suggestionPitch, fontSize: HOME.suggestionFontSize }}
              >
                <span className="grid size-5 shrink-0 place-items-center">{row.mark}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" dir="auto">
                  {row.label}
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      </motion.div>
    </div>
  );
}
