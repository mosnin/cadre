import type { ThreadMessage } from "@cadre/contracts";

/**
 * Defensive view of a `subagent` block. The contract is being extended with optional fields
 * (nesting, type, model, usage, steps, "cancelled"), so everything beyond the original five fields
 * is optional and `status` is any string: unknown values render neutrally.
 */
export type SubagentView = {
  agentId: string;
  name: string;
  task: string;
  status: string;
  progress?: string;
  result?: string;
  runId?: string;
  parentAgentId?: string | null;
  depth?: number;
  agentType?: string;
  /** Bot that spawned this sub-agent (shown in group threads). */
  spawnedByBotId?: string;
  spawnedByBotName?: string;
  model?: string;
  background?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  steps?: { label: string; count: number }[];
};

export type SubagentRow = { agent: SubagentView; level: number };

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Read the optional extended fields off a raw payload or block, ignoring malformed values. */
export function subagentExtras(source: Record<string, unknown>): Partial<SubagentView> {
  const extras: Partial<SubagentView> = {};
  const status = str(source.status);
  if (status) extras.status = status;
  const runId = str(source.runId);
  if (runId) extras.runId = runId;
  if (source.parentAgentId === null) extras.parentAgentId = null;
  else {
    const parent = str(source.parentAgentId);
    if (parent) extras.parentAgentId = parent;
  }
  const depth = num(source.depth);
  if (depth !== undefined) extras.depth = depth;
  const agentType = str(source.agentType);
  if (agentType) extras.agentType = agentType;
  const spawner = str(source.spawnedByBotId);
  if (spawner) extras.spawnedByBotId = spawner;
  const spawnerName = str(source.spawnedByBotName);
  if (spawnerName) extras.spawnedByBotName = spawnerName;
  const model = str(source.model);
  if (model) extras.model = model;
  if (typeof source.background === "boolean") extras.background = source.background;
  const usage = source.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    extras.usage = { inputTokens: num(u.inputTokens) ?? 0, outputTokens: num(u.outputTokens) ?? 0 };
  }
  if (Array.isArray(source.steps)) {
    const steps = source.steps.flatMap((step) => {
      if (!step || typeof step !== "object") return [];
      const s = step as Record<string, unknown>;
      const label = str(s.label);
      return label ? [{ label, count: Math.max(1, num(s.count) ?? 1) }] : [];
    });
    if (steps.length > 0) extras.steps = steps;
  }
  return extras;
}

/**
 * Merge the extended fields of `payload` into the block the shared projection produced, so a live
 * event keeps its nesting and "cancelled" status even before the shared projection learns them.
 */
export function withSubagentExtras<T extends object>(
  block: T,
  payload: Record<string, unknown>,
): T {
  return { ...block, ...subagentExtras(payload) };
}

export function toSubagentView(block: unknown): SubagentView {
  const b = (block ?? {}) as Record<string, unknown>;
  return {
    agentId: String(b.agentId ?? ""),
    name: String(b.name ?? "subagent"),
    task: String(b.task ?? ""),
    status: str(b.status) ?? "running",
    progress: str(b.progress),
    result: str(b.result),
    ...subagentExtras(b),
  };
}

export function isSubagentRunning(agent: Pick<SubagentView, "status">): boolean {
  return agent.status === "running";
}

/** Depth-first rows, children under their parent. Unknown or cyclic parents become roots. */
export function flattenSubagents(agents: SubagentView[]): SubagentRow[] {
  const byId = new Map<string, SubagentView>();
  for (const agent of agents) byId.set(agent.agentId, agent);
  const children = new Map<string, SubagentView[]>();
  const roots: SubagentView[] = [];
  for (const agent of byId.values()) {
    const parent = agent.parentAgentId;
    if (parent && parent !== agent.agentId && byId.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(agent);
      children.set(parent, list);
    } else {
      roots.push(agent);
    }
  }
  const rows: SubagentRow[] = [];
  const seen = new Set<string>();
  const visit = (agent: SubagentView, level: number) => {
    if (seen.has(agent.agentId)) return;
    seen.add(agent.agentId);
    rows.push({ agent, level });
    for (const child of children.get(agent.agentId) ?? []) visit(child, level + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const agent of byId.values()) visit(agent, 0);
  return rows;
}

/** Still in flight: running, or paused on the user's approval. */
export function isSubagentActive(agent: Pick<SubagentView, "status">): boolean {
  return agent.status === "running" || agent.status === "blocked";
}

export function subagentCounts(agents: SubagentView[]): {
  running: number;
  done: number;
  blocked: number;
} {
  const running = agents.filter(isSubagentActive).length;
  const blocked = agents.filter((agent) => agent.status === "blocked").length;
  return { running, done: agents.length - running, blocked };
}

export type PlanItemView = { id: string; title: string; status: string; agentId?: string };

/** Defensive read of a `plan` block: items [{id, title, status, agentId?}]. */
export function toPlanItems(block: unknown): PlanItemView[] {
  const raw = (block as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    const title = str(o.title) ?? str(o.label);
    if (!title) return [];
    return [
      {
        id: str(o.id) ?? String(index),
        title,
        status: str(o.status) ?? "pending",
        agentId: str(o.agentId),
      },
    ];
  });
}

export function subagentOnly(message: ThreadMessage): boolean {
  return message.blocks.length > 0 && message.blocks.every((block) => block.kind === "subagent");
}

/**
 * Group consecutive sub-agent-only messages of the same run and spawning bot so they render as one nested group.
 * `groups` is keyed by the first message of each run; `hidden` lists the folded-in followers.
 */
export function groupSubagentMessages(messages: readonly ThreadMessage[]): {
  groups: Map<string, SubagentView[]>;
  hidden: Set<string>;
} {
  const groups = new Map<string, SubagentView[]>();
  const hidden = new Set<string>();
  let current: { id: string; runId?: string; spawner?: string } | undefined;
  for (const message of messages) {
    if (!subagentOnly(message)) {
      // Provider tool-activity rows between sub-agents must not split a group.
      const onlyActivity = message.blocks.every(
        (block) => block.kind === "steps" || (block.kind === "progress" && block.activity === true),
      );
      if (!onlyActivity) current = undefined;
      continue;
    }
    const views = message.blocks.map(toSubagentView);
    const spawner = views[0]?.spawnedByBotId ?? message.botId;
    if (current && current.runId === message.runId && current.spawner === spawner) {
      groups.get(current.id)?.push(...views);
      hidden.add(message.id);
    } else {
      current = { id: message.id, runId: message.runId, spawner };
      groups.set(message.id, views);
    }
  }
  return { groups, hidden };
}

export function formatTokens(usage: SubagentView["usage"]): string | undefined {
  if (!usage) return undefined;
  const total = usage.inputTokens + usage.outputTokens;
  if (total <= 0) return undefined;
  return total >= 1000 ? `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k` : String(total);
}

/** A per-bot custom agent type (`agents` in bot settings). */
export type AgentTypeDraft = {
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  model?: string;
};

export const AGENT_TYPES_MAX = 12;
export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export type AgentTypeIssue = "name-invalid" | "name-duplicate" | "too-many";

export function agentNameIssue(
  name: string,
  agents: readonly Pick<AgentTypeDraft, "name">[],
): AgentTypeIssue | undefined {
  if (!AGENT_NAME_PATTERN.test(name)) return "name-invalid";
  if (agents.filter((agent) => agent.name === name).length > 1) return "name-duplicate";
  return undefined;
}

/** True when the list can be sent to the server. */
export function agentTypesValid(agents: readonly AgentTypeDraft[]): boolean {
  return (
    agents.length <= AGENT_TYPES_MAX &&
    agents.every((agent) => agentNameIssue(agent.name, agents) === undefined)
  );
}

/** Drop empty optional fields so the stored shape stays minimal. */
export function normalizeAgentTypes(agents: readonly AgentTypeDraft[]): AgentTypeDraft[] {
  return agents.map((agent) => {
    const tools = agent.tools?.map((tool) => tool.trim()).filter(Boolean);
    const model = agent.model?.trim();
    return {
      name: agent.name.trim(),
      description: agent.description.trim(),
      instructions: agent.instructions.trim(),
      ...(tools?.length ? { tools } : {}),
      ...(model ? { model } : {}),
    };
  });
}
