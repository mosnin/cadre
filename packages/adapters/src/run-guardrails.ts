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

export class RunGuardrailError extends Error {}

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
    throw new RunGuardrailError("Run safety state is invalid. Start a new task.");
  }
  if (state.count >= limit)
    throw new RunGuardrailError(
      `Stopped at the ${limit}-tool run limit. Send a new message to continue.`,
    );
  if ((name === "spawn_bot" || name === "schedule_create") && trigger !== "user") {
    throw new RunGuardrailError(
      "Creating bots or schedules requires a direct user request. Automated runs cannot create more automation.",
    );
  }
  const automation = { ...state.automation };
  if (Object.hasOwn(AUTOMATION_LIMITS, name)) {
    const used = automation[name] ?? 0;
    if (!Number.isSafeInteger(used) || used < 0 || used >= AUTOMATION_LIMITS[name]!) {
      throw new RunGuardrailError(
        `Stopped at the per-run limit for ${name}. Send a new message to continue.`,
      );
    }
    automation[name] = used + 1;
  }
  // Persist only a digest, never tool arguments or secrets. Text between calls cannot reset it.
  const key = createHash("sha256")
    .update(JSON.stringify([name, canonical(args)]))
    .digest("hex");
  if (state.recent.filter((prior) => prior === key).length >= 5) {
    throw new RunGuardrailError(
      "Stopped a repeated tool-call loop. Review the task before continuing.",
    );
  }
  return { count: state.count + 1, recent: [...state.recent, key].slice(-24), automation };
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
        );
      const owner = await tx.user.findUnique({
        where: { id: run.userId },
        select: { suspendedAt: true },
      });
      if (!owner || owner.suspendedAt)
        throw new RunGuardrailError("This account is suspended. No further tools were started.");
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
