import { createHash } from "node:crypto";
import { type PrismaClient, withTransactionRetry } from "@rakazo/db";

export function boundedLimit(raw: string | undefined, fallback: number, maximum: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), maximum) : fallback;
}

export function maxToolCallsPerTurn(env: NodeJS.ProcessEnv = process.env): number {
  return boundedLimit(env.MAX_TOOL_CALLS_PER_TURN, 200, 1000);
}

export function maxRunDurationMs(env: NodeJS.ProcessEnv = process.env): number {
  return boundedLimit(env.MAX_RUN_DURATION_MS, 20 * 60_000, 60 * 60_000);
}

export function maxRunTokens(env: NodeJS.ProcessEnv = process.env): number {
  return boundedLimit(env.MAX_RUN_TOKENS, 500_000, 2_000_000);
}

/** Triggers with no person waiting on the thread, so a run may continue across budget segments. */
const UNATTENDED_TRIGGERS = new Set(["routine", "webhook", "bot_message", "spawn"]);

/**
 * How many budget segments (each with a fresh time, tool and token budget) a run may
 * chain through before it stops. Attended runs keep one segment so the person can
 * decide whether to continue; unattended runs continue on their own.
 */
export function maxRunSegments(trigger: string, env: NodeJS.ProcessEnv = process.env): number {
  if (!UNATTENDED_TRIGGERS.has(trigger)) return boundedLimit(env.MAX_ATTENDED_RUN_SEGMENTS, 1, 24);
  return boundedLimit(env.MAX_RUN_SEGMENTS, 6, 24);
}

/** How long an unattended run may wait for approval or takeover before it fails. */
export function unattendedWaitMs(env: NodeJS.ProcessEnv = process.env): number {
  return boundedLimit(env.UNATTENDED_WAIT_MS, 30 * 60_000, 24 * 60 * 60_000);
}

export function isUnattendedTrigger(trigger: string): boolean {
  return UNATTENDED_TRIGGERS.has(trigger);
}

/**
 * budget: a time, tool or token limit was reached (the run may continue in a new segment).
 * loop: the same call repeated; lease: this worker no longer owns the run;
 * abuse: automation tried to create more automation or the run state is invalid.
 * Only abuse pauses a schedule; every other kind ends or continues the run and leaves
 * the schedule active.
 */
export type RunGuardrailKind = "budget" | "loop" | "lease" | "abuse";

export class RunGuardrailError extends Error {
  readonly kind: RunGuardrailKind;
  constructor(message: string, kind: RunGuardrailKind = "budget") {
    super(message);
    this.kind = kind;
  }
}

export function routinePausesOnGuardrail(error: unknown): boolean {
  return error instanceof RunGuardrailError && error.kind === "abuse";
}

export function isBudgetGuardrail(error: unknown): boolean {
  return error instanceof RunGuardrailError && error.kind === "budget";
}

type GuardrailState = { count: number; recent: string[]; automation: Record<string, number> };
const AUTOMATION_LIMITS: Record<string, number> = {
  spawn_bot: 4,
  schedule_create: 4,
  message_bot: 8,
  handoff_to_bot: 1,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function advanceRunGuardrail(
  previous: unknown,
  name: string,
  args: unknown,
  trigger: string,
  limit = maxToolCallsPerTurn(),
): GuardrailState {
  const state =
    previous == null ? { count: 0, recent: [], automation: {} } : (previous as GuardrailState);
  if (
    !Number.isSafeInteger(state.count) ||
    state.count < 0 ||
    !Array.isArray(state.recent) ||
    state.recent.length > 24 ||
    state.recent.some((key) => typeof key !== "string") ||
    !state.automation ||
    typeof state.automation !== "object" ||
    Array.isArray(state.automation)
  ) {
    throw new RunGuardrailError("Run safety state is invalid. Start a new task.", "abuse");
  }
  if (state.count >= limit)
    throw new RunGuardrailError(
      `Stopped at the ${limit}-tool run limit. Send a new message to continue.`,
      "budget",
    );
  if ((name === "spawn_bot" || name === "schedule_create") && trigger !== "user") {
    throw new RunGuardrailError(
      "Creating bots or schedules requires a direct user request. Automated runs cannot create more automation.",
      "abuse",
    );
  }
  const automation = { ...state.automation };
  if (Object.hasOwn(AUTOMATION_LIMITS, name)) {
    const used = automation[name] ?? 0;
    if (!Number.isSafeInteger(used) || used < 0 || used >= AUTOMATION_LIMITS[name]!) {
      throw new RunGuardrailError(
        `Stopped at the per-run limit for ${name}. Send a new message to continue.`,
        "abuse",
      );
    }
    automation[name] = used + 1;
  }
  const canonicalArgs = canonical(args);
  // Observation tools take no arguments, so every call looks identical. Repeating them is
  // how a browser or desktop task verifies each step, not a loop.
  if (isArgumentless(canonicalArgs)) {
    return { count: state.count + 1, recent: state.recent, automation };
  }
  // Persist only a digest, never tool arguments or secrets. Text between calls cannot reset it.
  const key = createHash("sha256")
    .update(JSON.stringify([name, canonicalArgs]))
    .digest("hex");
  if (state.recent.filter((prior) => prior === key).length >= 5) {
    throw new RunGuardrailError(
      "Stopped a repeated tool-call loop. Review the task before continuing.",
      "loop",
    );
  }
  return { count: state.count + 1, recent: [...state.recent, key].slice(-24), automation };
}

function isArgumentless(canonicalArgs: unknown): boolean {
  if (canonicalArgs == null) return true;
  if (typeof canonicalArgs !== "object") return false;
  return Object.keys(canonicalArgs).length === 0;
}

/**
 * Start a new budget segment: the tool count restarts while loop history and automation
 * fan-out limits carry over, so a continued run cannot create more bots or schedules than
 * a single run could.
 */
export async function resetRunToolBudget(
  prisma: PrismaClient,
  run: { id: string; spaceId: string; userId: string },
) {
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM runs WHERE id = ${run.id} AND "spaceId" = ${run.spaceId} AND "userId" = ${run.userId} FOR UPDATE`;
      const current = await tx.run.findFirst({
        where: { id: run.id, spaceId: run.spaceId, userId: run.userId },
        select: { guardrailState: true },
      });
      const previous = (current?.guardrailState ?? null) as GuardrailState | null;
      const state: GuardrailState = {
        count: 0,
        recent: Array.isArray(previous?.recent) ? previous.recent : [],
        automation:
          previous?.automation && typeof previous.automation === "object"
            ? previous.automation
            : {},
      };
      await tx.run.update({ where: { id: run.id }, data: { guardrailState: state } });
    }),
  );
}

/** Reserve before any tool work; row locking makes concurrent calls and resumed runs share limits. */
export async function reserveRunTool(
  prisma: PrismaClient,
  run: { id: string; spaceId: string; userId: string },
  workerId: string,
  fence: number,
  name: string,
  args: unknown,
) {
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM runs WHERE id = ${run.id} AND "spaceId" = ${run.spaceId} AND "userId" = ${run.userId} FOR UPDATE`;
      const current = await tx.run.findFirst({
        where: {
          id: run.id,
          spaceId: run.spaceId,
          userId: run.userId,
          status: "running",
          leaseOwner: workerId,
          leaseFence: fence,
          leaseExpiresAt: { gt: new Date() },
        },
        select: { guardrailState: true, trigger: true, sourceMessageId: true, threadId: true },
      });
      if (!current)
        throw new RunGuardrailError(
          "This run no longer owns execution. No further tools were started.",
          "lease",
        );
      const owner = await tx.user.findUnique({
        where: { id: run.userId },
        select: { suspendedAt: true },
      });
      if (!owner || owner.suspendedAt)
        throw new RunGuardrailError(
          "This account is suspended. No further tools were started.",
          "abuse",
        );
      let trigger = current.trigger;
      if ((name === "spawn_bot" || name === "schedule_create") && trigger === "follow_up") {
        // User steering and agent handoffs share a trigger; inspect the server-owned source.
        const source = current.sourceMessageId
          ? await tx.message.findFirst({
              where: { id: current.sourceMessageId, threadId: current.threadId, role: "user" },
              select: { blocks: true },
            })
          : null;
        if (
          source &&
          Array.isArray(source.blocks) &&
          !source.blocks.some(
            (block) =>
              block &&
              typeof block === "object" &&
              "kind" in block &&
              block.kind === "bot_message_received",
          )
        )
          trigger = "user";
      }
      const state = advanceRunGuardrail(current.guardrailState, name, args, trigger);
      await tx.run.update({ where: { id: run.id }, data: { guardrailState: state } });
    }),
  );
}
