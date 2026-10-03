import {
  type Actor,
  HIVE_DEFAULT_BUDGET_TOKENS,
  HIVE_MEMBER_MAX,
  type Hive,
  type HiveDetail,
  type HiveEvidence,
  HiveExternalSchema,
  type HiveGoal,
  HiveGoalSchema,
  type HiveReceipt,
  type HiveRole,
  type HiveStatus,
  type HiveTask,
  hiveRolesError,
  type UpdateHiveInput,
} from "@cadre/contracts";
import { computeRealityLevel, isTerminalTask } from "@cadre/core";
import type { Prisma, PrismaClient } from "./client.js";
import { appendEventInTransaction } from "./events.js";
import { lockOwnedGroup } from "./groups.js";
import { IsolationError } from "./scope.js";

/** A hive rule the caller broke; the message is safe to show. */
export class HiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiveError";
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

export const emptyGoal = (): HiveGoal => HiveGoalSchema.parse({});

function parseGoal(value: unknown): HiveGoal {
  const parsed = HiveGoalSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyGoal();
}

type HiveRow = {
  id: string;
  groupId: string;
  spaceId: string;
  userId: string;
  goal: unknown;
  status: string;
  realityLevel: number;
  budgetTokens: number;
  external: unknown;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Tokens used by runs in the hive thread (workers, wakes, sub-agents, plain chat). */
export async function hiveSpentTokens(db: Db, threadId: string): Promise<number> {
  const ids = (await db.run.findMany({ where: { threadId }, select: { id: true } })).map(
    (run) => run.id,
  );
  if (ids.length === 0) return 0;
  const total = await db.usageRecord.aggregate({
    where: { runId: { in: ids } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (total._sum.inputTokens ?? 0) + (total._sum.outputTokens ?? 0);
}

async function hiveContext(db: Db, row: Pick<HiveRow, "groupId">) {
  const [group, thread] = await Promise.all([
    db.chatGroup.findUnique({ where: { id: row.groupId }, select: { name: true } }),
    db.thread.findUnique({ where: { groupId: row.groupId }, select: { id: true } }),
  ]);
  if (!thread) throw new IsolationError("Hive is missing its thread");
  return { name: group?.name ?? "", threadId: thread.id };
}

export async function toHive(db: Db, row: HiveRow): Promise<Hive> {
  const { name, threadId } = await hiveContext(db, row);
  const external = HiveExternalSchema.safeParse(row.external);
  return {
    id: row.id,
    groupId: row.groupId,
    threadId,
    spaceId: row.spaceId,
    name,
    goal: parseGoal(row.goal),
    status: row.status as HiveStatus,
    realityLevel: row.realityLevel,
    budgetTokens: row.budgetTokens,
    spentTokens: await hiveSpentTokens(db, threadId),
    external: external.success ? external.data : null,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type TaskRow = {
  id: string;
  hiveId: string;
  key: string;
  parentId: string | null;
  title: string;
  brief: string;
  acceptance: unknown;
  ownership: string[];
  assigneeBotId: string | null;
  creatorBotId: string | null;
  status: string;
  attempts: number;
  runId: string | null;
  claimLeaseUntil: Date | null;
  seq: number;
  updatedAt: Date;
};

function toEvidence(row: {
  id: string;
  taskId: string;
  kind: string;
  ref: string;
  summary: string;
  sha256: string | null;
  authorBotId: string;
  runId: string | null;
  createdAt: Date;
}): HiveEvidence {
  return {
    id: row.id,
    taskId: row.taskId,
    kind: row.kind as HiveEvidence["kind"],
    ref: row.ref,
    summary: row.summary,
    sha256: row.sha256,
    authorBotId: row.authorBotId,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toReceipt(row: {
  id: string;
  taskId: string;
  auditorBotId: string;
  verdict: string;
  notes: string;
  scores: unknown;
  createdAt: Date;
}): HiveReceipt {
  return {
    id: row.id,
    taskId: row.taskId,
    auditorBotId: row.auditorBotId,
    verdict: row.verdict as HiveReceipt["verdict"],
    notes: row.notes,
    scores: row.scores && typeof row.scores === "object" ? (row.scores as Record<string, number>) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Tasks of a hive with dependencies, evidence and the latest receipt, in plan order. */
export async function loadHiveTasks(db: Db, hiveId: string, taskIds?: string[]): Promise<HiveTask[]> {
  const rows = (await db.hiveTask.findMany({
    where: { hiveId, ...(taskIds ? { id: { in: taskIds } } : {}) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  })) as TaskRow[];
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [deps, evidence, receipts] = await Promise.all([
    db.hiveTaskDependency.findMany({ where: { taskId: { in: ids } } }),
    db.hiveEvidence.findMany({ where: { taskId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    db.hiveReceipt.findMany({ where: { taskId: { in: ids } }, orderBy: { createdAt: "asc" } }),
  ]);
  return rows.map((row) => {
    const taskReceipts = receipts.filter((receipt) => receipt.taskId === row.id);
    const latest = taskReceipts[taskReceipts.length - 1];
    const acceptance = Array.isArray(row.acceptance)
      ? (row.acceptance as Array<{ id: string; text: string }>)
      : [];
    return {
      id: row.id,
      hiveId: row.hiveId,
      key: row.key,
      parentId: row.parentId,
      title: row.title,
      brief: row.brief,
      acceptance,
      ownership: row.ownership,
      dependsOn: deps.filter((dep) => dep.taskId === row.id).map((dep) => dep.dependsOnId),
      assigneeBotId: row.assigneeBotId,
      creatorBotId: row.creatorBotId,
      status: row.status as HiveTask["status"],
      attempts: row.attempts,
      runId: row.runId,
      claimLeaseUntil: row.claimLeaseUntil?.toISOString() ?? null,
      seq: row.seq,
      evidence: evidence.filter((item) => item.taskId === row.id).map(toEvidence),
      latestReceipt: latest ? toReceipt(latest) : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function loadHiveMembers(
  db: Db,
  groupId: string,
): Promise<Array<{ botId: string; role: HiveRole }>> {
  const rows = await db.chatGroupMember.findMany({
    where: { groupId },
    orderBy: { createdAt: "asc" },
    select: { botId: true, role: true },
  });
  return rows.map((row) => ({ botId: row.botId, role: row.role as HiveRole }));
}

export async function loadHiveDetail(db: Db, hiveId: string): Promise<HiveDetail> {
  const row = await db.hive.findUnique({ where: { id: hiveId } });
  if (!row) throw new IsolationError();
  const [hive, members, tasks] = await Promise.all([
    toHive(db, row),
    loadHiveMembers(db, row.groupId),
    loadHiveTasks(db, hiveId),
  ]);
  return { hive, members, tasks };
}

/** Bump the hive's change counter; clients order hive and task updates by it. */
export async function bumpHive(db: Db, hiveId: string): Promise<number> {
  const row = await db.hive.update({
    where: { id: hiveId },
    data: { seq: { increment: 1 } },
    select: { seq: true },
  });
  return row.seq;
}

/** Event rows are attributed to a bot of the hive; use the acting bot or the leader. */
async function eventBotId(db: Db, groupId: string, preferred?: string): Promise<string> {
  if (preferred) return preferred;
  const members = await loadHiveMembers(db, groupId);
  const leader = members.find((member) => member.role === "leader") ?? members[0];
  if (!leader) throw new IsolationError();
  return leader.botId;
}

/** Append `hive.updated` for the hive's current state. Returns the event seq to notify. */
export async function appendHiveUpdated(
  tx: Prisma.TransactionClient,
  hiveId: string,
  actingBotId?: string,
): Promise<number> {
  const row = await tx.hive.findUnique({ where: { id: hiveId } });
  if (!row) throw new IsolationError();
  const hive = await toHive(tx, row);
  const event = await appendEventInTransaction(tx, {
    spaceId: row.spaceId,
    threadId: hive.threadId,
    botId: await eventBotId(tx, row.groupId, actingBotId),
    type: "hive.updated",
    payload: { hive },
  });
  return event.seq;
}

/** Append `hive.task.updated` for each task. Returns the last event seq to notify. */
export async function appendHiveTaskUpdated(
  tx: Prisma.TransactionClient,
  hiveId: string,
  taskIds: string[],
  actingBotId?: string,
): Promise<number> {
  const row = await tx.hive.findUnique({ where: { id: hiveId } });
  if (!row) throw new IsolationError();
  const { threadId } = await hiveContext(tx, row);
  const botId = await eventBotId(tx, row.groupId, actingBotId);
  let seq = 0;
  for (const task of await loadHiveTasks(tx, hiveId, taskIds)) {
    const event = await appendEventInTransaction(tx, {
      spaceId: row.spaceId,
      threadId,
      botId,
      type: "hive.task.updated",
      payload: { task },
    });
    seq = event.seq;
  }
  return seq;
}

/** Recompute the reality level from accepted evidence. It only ever rises. */
export async function syncRealityLevel(tx: Prisma.TransactionClient, hiveId: string) {
  const [hive, tasks] = await Promise.all([
    tx.hive.findUnique({ where: { id: hiveId }, select: { realityLevel: true } }),
    loadHiveTasks(tx, hiveId),
  ]);
  if (!hive) return;
  const level = computeRealityLevel(
    tasks.map((task) => ({
      id: task.id,
      status: task.status,
      dependsOn: task.dependsOn,
      evidenceKinds: task.evidence.map((item) => item.kind),
    })),
  );
  if (level > hive.realityLevel) {
    await tx.hive.update({ where: { id: hiveId }, data: { realityLevel: level } });
  }
}

// --- user-facing repository ------------------------------------------------------------------

async function ownedBotIds(db: Db, actor: Actor, botIds: string[]) {
  const bots = await db.bot.findMany({
    where: { id: { in: botIds }, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
    select: { id: true },
  });
  if (bots.length !== new Set(botIds).size) throw new IsolationError();
}

function assertRoles(members: ReadonlyArray<{ role: HiveRole }>) {
  const error = hiveRolesError(members);
  if (error) throw new HiveError(error);
}

export function createHiveRepos(
  prisma: PrismaClient,
  notify?: (threadId: string, seq: number) => Promise<void>,
) {
  const notifyHive = async (hive: Pick<Hive, "threadId">, seq: number) => {
    if (seq > 0) await notify?.(hive.threadId, seq).catch(() => undefined);
  };

  async function ownedHive(db: Db, actor: Actor, hiveId: string) {
    const row = await db.hive.findFirst({
      where: { id: hiveId, spaceId: actor.spaceId, userId: actor.userId },
    });
    if (!row) throw new IsolationError();
    return row;
  }

  /** Lock the group (like every group write) and return the hive row. */
  async function lockedHive(tx: Prisma.TransactionClient, actor: Actor, hiveId: string) {
    const row = await ownedHive(tx, actor, hiveId);
    await lockOwnedGroup(tx, actor, row.groupId);
    return (await tx.hive.findUnique({ where: { id: hiveId } })) ?? row;
  }

  async function finishHive(committed: { hiveId: string; seq: number }) {
    const result = await loadHiveDetail(prisma, committed.hiveId);
    await notifyHive(result.hive, committed.seq);
    return result;
  }

  async function detail(actor: Actor, hiveId: string) {
    await ownedHive(prisma, actor, hiveId);
    return loadHiveDetail(prisma, hiveId);
  }

  async function setStatus(actor: Actor, hiveId: string, status: HiveStatus): Promise<Hive> {
    const seq = await prisma.$transaction(async (tx) => {
      const row = await lockedHive(tx, actor, hiveId);
      if (row.status === "cancelled" || row.status === "accepted") {
        throw new HiveError(`This hive is ${row.status}.`);
      }
      if (row.status === status) return 0;
      await tx.hive.update({ where: { id: hiveId }, data: { status } });
      if (status === "cancelled") {
        const live = (await tx.hiveTask.findMany({ where: { hiveId } })).filter(
          (task) => !isTerminalTask(task.status),
        );
        if (live.length > 0) {
          await tx.hiveTask.updateMany({
            where: { id: { in: live.map((task) => task.id) } },
            data: { status: "cancelled", claimLeaseUntil: null },
          });
        }
        await tx.hiveWake.updateMany({
          where: { hiveId, consumedAt: null },
          data: { consumedAt: new Date() },
        });
      }
      await bumpHive(tx, hiveId);
      return appendHiveUpdated(tx, hiveId);
    });
    const hive = (await loadHiveDetail(prisma, hiveId)).hive;
    await notifyHive(hive, seq);
    return hive;
  }

  return {
    async create(
      actor: Actor,
      input: {
        name: string;
        members: Array<{ botId: string; role: HiveRole }>;
        goal?: HiveGoal;
        budgetTokens?: number;
      },
    ): Promise<HiveDetail> {
      if (input.members.length > HIVE_MEMBER_MAX) throw new HiveError("Too many members");
      assertRoles(input.members);
      await ownedBotIds(
        prisma,
        actor,
        input.members.map((member) => member.botId),
      );
      const created = await prisma.$transaction(async (tx) => {
        const group = await tx.chatGroup.create({
          data: { spaceId: actor.spaceId, userId: actor.userId, name: input.name.trim() },
        });
        await tx.chatGroupMember.createMany({
          data: input.members.map((member) => ({
            groupId: group.id,
            botId: member.botId,
            role: member.role,
          })),
        });
        await tx.thread.create({
          data: { spaceId: actor.spaceId, groupId: group.id, userId: actor.userId },
        });
        const hive = await tx.hive.create({
          data: {
            groupId: group.id,
            spaceId: actor.spaceId,
            userId: actor.userId,
            goal: (input.goal ?? emptyGoal()) as Prisma.InputJsonValue,
            budgetTokens: input.budgetTokens ?? HIVE_DEFAULT_BUDGET_TOKENS,
          },
        });
        return { hiveId: hive.id, seq: await appendHiveUpdated(tx, hive.id) };
      });
      return finishHive(created);
    },

    async fromGroup(
      actor: Actor,
      input: {
        groupId: string;
        roles: Array<{ botId: string; role: HiveRole }>;
        goal?: HiveGoal;
        budgetTokens?: number;
      },
    ): Promise<HiveDetail> {
      assertRoles(input.roles);
      const created = await prisma.$transaction(async (tx) => {
        await lockOwnedGroup(tx, actor, input.groupId);
        const group = await tx.chatGroup.findFirst({
          where: { id: input.groupId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
          select: { id: true },
        });
        if (!group) throw new IsolationError();
        if (await tx.hive.findUnique({ where: { groupId: group.id } })) {
          throw new HiveError("This group is already a hive.");
        }
        const members = await tx.chatGroupMember.findMany({ where: { groupId: group.id } });
        const memberIds = new Set(members.map((member) => member.botId));
        if (input.roles.some((entry) => !memberIds.has(entry.botId))) {
          throw new HiveError("Every role must name a member of the group.");
        }
        for (const entry of input.roles) {
          await tx.chatGroupMember.updateMany({
            where: { groupId: group.id, botId: entry.botId },
            data: { role: entry.role },
          });
        }
        const hive = await tx.hive.create({
          data: {
            groupId: group.id,
            spaceId: actor.spaceId,
            userId: actor.userId,
            goal: (input.goal ?? emptyGoal()) as Prisma.InputJsonValue,
            budgetTokens: input.budgetTokens ?? HIVE_DEFAULT_BUDGET_TOKENS,
          },
        });
        return { hiveId: hive.id, seq: await appendHiveUpdated(tx, hive.id) };
      });
      return finishHive(created);
    },

    get: detail,

    async byGroup(actor: Actor, groupId: string): Promise<HiveDetail | null> {
      const row = await prisma.hive.findFirst({
        where: { groupId, spaceId: actor.spaceId, userId: actor.userId },
        select: { id: true },
      });
      return row ? loadHiveDetail(prisma, row.id) : null;
    },

    async list(actor: Actor): Promise<Hive[]> {
      const rows = await prisma.hive.findMany({
        where: { spaceId: actor.spaceId, userId: actor.userId },
        orderBy: { updatedAt: "desc" },
      });
      return Promise.all(rows.map((row) => toHive(prisma, row)));
    },

    async update(actor: Actor, input: UpdateHiveInput): Promise<Hive> {
      const edited = await prisma.$transaction(async (tx) => {
        const row = await lockedHive(tx, actor, input.hiveId);
        if (row.status === "cancelled" || row.status === "accepted") {
          throw new HiveError(`This hive is ${row.status}.`);
        }
        await tx.hive.update({
          where: { id: row.id },
          data: {
            ...(input.goal ? { goal: input.goal as Prisma.InputJsonValue } : {}),
            ...(input.budgetTokens ? { budgetTokens: input.budgetTokens } : {}),
            ...(input.external !== undefined
              ? {
                  external:
                    input.external === null
                      ? (null as unknown as Prisma.InputJsonValue)
                      : (input.external as Prisma.InputJsonValue),
                }
              : {}),
          },
        });
        await bumpHive(tx, row.id);
        return { hiveId: row.id, seq: await appendHiveUpdated(tx, row.id) };
      });
      const { hive } = await finishHive(edited);
      return input.status ? setStatus(actor, input.hiveId, input.status) : hive;
    },

    async setRole(actor: Actor, input: { hiveId: string; botId: string; role: HiveRole }) {
      const changed = await prisma.$transaction(async (tx) => {
        const row = await lockedHive(tx, actor, input.hiveId);
        const members = await loadHiveMembers(tx, row.groupId);
        if (!members.some((member) => member.botId === input.botId)) throw new IsolationError();
        assertRoles(members.map((member) => (member.botId === input.botId ? { role: input.role } : member)));
        const busy = await tx.hiveTask.count({
          where: {
            hiveId: row.id,
            assigneeBotId: input.botId,
            status: { in: ["running", "in_review", "rework"] },
          },
        });
        if (busy > 0 && input.role !== "worker") {
          throw new HiveError("This member has a task in flight; wait for it to finish.");
        }
        await tx.chatGroupMember.updateMany({
          where: { groupId: row.groupId, botId: input.botId },
          data: { role: input.role },
        });
        await bumpHive(tx, row.id);
        return { hiveId: row.id, seq: await appendHiveUpdated(tx, row.id) };
      });
      return finishHive(changed);
    },

    pause: (actor: Actor, hiveId: string) => setStatus(actor, hiveId, "paused"),
    resume: (actor: Actor, hiveId: string) => setStatus(actor, hiveId, "running"),
    cancel: (actor: Actor, hiveId: string) => setStatus(actor, hiveId, "cancelled"),
  };
}
