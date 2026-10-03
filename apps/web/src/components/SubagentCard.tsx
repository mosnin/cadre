import { ChatMarkdown } from "@cadre/chat-ui/web";
import { BotAvatar } from "@cadre/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronRight, CircleAlert, CircleSlash, Loader2, X } from "lucide-react";
import { useState } from "react";
import {
  flattenSubagents,
  formatTokens,
  isSubagentRunning,
  type PlanItemView,
  type SubagentView,
  subagentCounts,
} from "../lib/subagents.js";

function statusTone(status: string): string {
  if (status === "failed") return "bg-destructive/15 text-destructive";
  if (status === "running") return "bg-warning/15 text-warning";
  if (status === "completed") return "bg-success/15 text-success";
  if (status === "blocked") return "bg-warning text-background font-medium";
  return "bg-foreground/10 text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  const cls = "size-4 shrink-0";
  if (status === "running") return <Loader2 className={`${cls} animate-spin text-warning`} />;
  if (status === "completed") return <Check className={`${cls} text-success`} />;
  if (status === "failed") return <X className={`${cls} text-destructive`} />;
  if (status === "blocked") return <CircleAlert className={`${cls} text-warning`} />;
  return <CircleSlash className={`${cls} text-muted-foreground`} />;
}

function SubagentCard({ agent, level }: { agent: SubagentView; level: number }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(agent.status === "blocked");
  const running = isSubagentRunning(agent);
  const statusLabel =
    agent.status === "running"
      ? t`Running`
      : agent.status === "completed"
        ? t`Done`
        : agent.status === "failed"
          ? t`Failed`
          : agent.status === "cancelled"
            ? t`Cancelled`
            : agent.status === "blocked"
              ? t`Needs your approval`
              : agent.status === "interrupted"
                ? t`Interrupted`
                : agent.status;
  const tokens = formatTokens(agent.usage);
  const hasDetails = Boolean(agent.task || agent.steps?.length || agent.progress || agent.result);
  const collapsedLine = running
    ? agent.progress
    : agent.result?.split("\n").find((line) => line.trim().length > 0);
  return (
    <div
      data-subagent-id={agent.agentId}
      data-subagent-level={level}
      className="rounded-[14px] border border-border bg-muted"
      style={{ marginInlineStart: Math.min(level, 3) * 16 }}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={!hasDetails}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-start"
      >
        <StatusIcon status={agent.status} />
        <span className="min-w-0 truncate text-[14.5px] font-medium text-foreground" dir="auto">
          {agent.name}
        </span>
        {agent.agentType ? (
          <span className="shrink-0 rounded-full bg-foreground/10 px-2 py-0.5 text-[12px] text-muted-foreground">
            {t`Sub-agent · ${agent.agentType}`}
          </span>
        ) : null}
        {agent.model ? (
          <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
            {agent.model}
          </span>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-2">
          {tokens ? (
            <span className="text-[12px] text-muted-foreground">{t`${tokens} tokens`}</span>
          ) : null}
          <span
            className={`rounded-full px-2.5 py-0.5 text-[12.5px] ${statusTone(agent.status)}`}
            style={{ animation: running ? "rkPulse 1.2s ease-in-out infinite" : undefined }}
          >
            {statusLabel}
          </span>
          {hasDetails ? (
            <ChevronRight
              className={`size-4 text-muted-foreground transition-transform rtl:rotate-180 ${open ? "rotate-90 rtl:rotate-90" : ""}`}
            />
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-3.5 py-3">
          {agent.task ? (
            <div className="text-[13.5px] text-muted-foreground" dir="auto">
              {agent.task}
            </div>
          ) : null}
          {agent.steps?.length ? (
            <ul className="space-y-0.5 text-[13px] text-foreground/80">
              {agent.steps.map((step) => (
                <li key={step.label}>
                  {step.label}
                  {step.count > 1 ? (
                    <span className="text-muted-foreground"> ×{step.count}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {running && agent.progress ? (
            <div className="text-[14px] leading-[1.5] text-foreground/75">
              <ChatMarkdown streaming>{agent.progress}</ChatMarkdown>
            </div>
          ) : null}
          {!running && agent.result ? (
            <div className="text-[14px] leading-[1.5] text-foreground/75">
              <ChatMarkdown>{agent.result}</ChatMarkdown>
            </div>
          ) : null}
        </div>
      ) : collapsedLine ? (
        <div className="truncate px-3.5 pb-2.5 text-[13px] text-muted-foreground" dir="auto">
          {collapsedLine}
        </div>
      ) : null}
    </div>
  );
}

/** One or more sub-agents of a run, nested under their parents. */
export function SubagentGroup({
  agents,
  spawner,
}: {
  agents: SubagentView[];
  /** The spawning bot, shown in group threads only. */
  spawner?: { botId: string; name: string; color: string };
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(true);
  const rows = flattenSubagents(agents);
  const { running, done, blocked } = subagentCounts(agents);
  const spawnerLabel = spawner ? (
    <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
      <BotAvatar color={spawner.color} identity={spawner.botId} size={16} />
      <span dir="auto">{spawner.name}</span>
    </div>
  ) : null;
  if (rows.length === 1 && rows[0]) {
    return (
      <div className="w-[min(480px,92%)]">
        {spawnerLabel}
        <SubagentCard agent={rows[0].agent} level={0} />
      </div>
    );
  }
  const summary =
    blocked > 0
      ? t`${blocked} sub-agents need your approval · ${done} done`
      : running > 0
        ? t`${running} sub-agents running · ${done} done`
        : t`${done} sub-agents done`;
  return (
    <div className="w-[min(520px,94%)] space-y-1.5" data-testid="subagent-group">
      {spawnerLabel}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
      >
        <ChevronRight
          className={`size-3.5 transition-transform rtl:rotate-180 ${open ? "rotate-90 rtl:rotate-90" : ""}`}
        />
        {running > 0 ? <Loader2 className="size-3.5 animate-spin text-warning" /> : null}
        <span>{summary}</span>
      </button>
      {open ? (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <SubagentCard key={row.agent.agentId} agent={row.agent} level={row.level} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Compact, collapsible task ledger for a root task. */
export function PlanCard({ items }: { items: PlanItemView[] }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === "done").length;
  return (
    <div
      className="w-[min(520px,94%)] rounded-[14px] border border-border bg-muted"
      data-testid="plan-card"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-start text-[14px] font-medium text-foreground"
      >
        <ChevronRight
          className={`size-4 text-muted-foreground transition-transform rtl:rotate-180 ${open ? "rotate-90 rtl:rotate-90" : ""}`}
        />
        {t`Plan`}
        <span className="ms-auto text-[12.5px] font-normal text-muted-foreground">
          {t`${done} of ${items.length} done`}
        </span>
      </button>
      {open ? (
        <ul className="space-y-1 border-t border-border px-3.5 py-2.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-[13.5px]">
              <StatusIcon status={item.status === "done" ? "completed" : item.status} />
              <span
                className={
                  item.status === "done" || item.status === "cancelled"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }
                dir="auto"
              >
                {item.title}
              </span>
              {item.status === "blocked" ? (
                <span className="ms-auto text-[12px] text-warning">{t`Blocked`}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
