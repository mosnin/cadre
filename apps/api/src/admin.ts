import { createHash, timingSafeEqual } from "node:crypto";
import { implement, ORPCError } from "@orpc/server";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { type BillingProvider, routineJobKey, routineWakeupJob } from "@rakazo/adapter-kit";
import { type Actor, adminContract } from "@rakazo/contracts";
import { nextCronDateAcrossStrict, parseAllowlist } from "@rakazo/core";
import { cancelUserRuns, type Prisma, type PrismaClient, withTransactionRetry } from "@rakazo/db";

type Context = { actor: Actor | null; sessionId?: string; signal?: AbortSignal };
export type AdminConfig = {
  emails: string;
  bootstrapTokenHash?: string;
  billing?: BillingProvider;
};
type Db = Pick<PrismaClient, "user" | "session">;
const ACTIVE = ["queued", "leased", "running", "waiting_input", "waiting_takeover"];
const FRESH_MS = 15 * 60_000;
const ok = { ok: true as const };
const iso = (date: Date | null) => date?.toISOString() ?? null;
const emailKey = (email: string) => email.trim().toLowerCase();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function userDto(user: {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  adminRole: string;
  suspendedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.adminRole === "admin" ? ("admin" as const) : ("member" as const),
    suspendedAt: iso(user.suspendedAt),
    createdAt: user.createdAt.toISOString(),
  };
}

async function identity(db: Db, context: Context) {
  if (!context.actor || !context.sessionId) throw new ORPCError("UNAUTHORIZED");
  const [user, session] = await Promise.all([
    db.user.findUnique({ where: { id: context.actor.userId } }),
    db.session.findFirst({
      where: { id: context.sessionId, userId: context.actor.userId, expiresAt: { gt: new Date() } },
    }),
  ]);
  if (!user || user.suspendedAt || !session) throw new ORPCError("UNAUTHORIZED");
  return { user, fresh: session.createdAt.getTime() > Date.now() - FRESH_MS };
}

async function requireAdmin(db: Db, context: Context, fresh = false) {
  const state = await identity(db, context);
  if (
    state.user.adminRole !== "admin" ||
    (!state.user.emailVerified && !state.user.adminVerifiedAt)
  )
    throw new ORPCError("FORBIDDEN");
  if (fresh && !state.fresh)
    throw new ORPCError("FORBIDDEN", {
      message: "Sign in again before making administrative changes.",
    });
  return state.user;
}

export function createAdminRouter(deps: {
  prisma: PrismaClient;
  jobs: JobPublisher;
  config?: AdminConfig;
}) {
  const { prisma, jobs } = deps;
  const config = deps.config ?? { emails: "" };
  const bootstrapEmails = new Set(config.emails.split(",").map(emailKey).filter(Boolean));
  const os = implement(adminContract).$context<Context>();
  const admin = os.use(async ({ context, next }) => {
    await requireAdmin(prisma, context);
    return next();
  });
  const paginate = (input: { cursor?: string }) => ({
    take: 51,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
  });
  function result<T extends { id: string }>(rows: T[]) {
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  }

  async function mutate(
    context: Context,
    input: { requestId: string; reason: string },
    action: string,
    targetId: string | null,
    work: (tx: Prisma.TransactionClient) => Promise<void>,
    status = "completed",
  ) {
    return withTransactionRetry(() =>
      prisma.$transaction(async (tx) => {
        // Serialize mutations by the acting administrator, then recheck authority inside the transaction.
        if (!context.actor) throw new ORPCError("UNAUTHORIZED");
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${context.actor.userId} FOR UPDATE`;
        const actor = await requireAdmin(tx as Db, context, true);
        const requestHash = digest({ action, targetId, input });
        const prior = await tx.adminAudit.findUnique({ where: { requestId: input.requestId } });
        if (prior) {
          if (
            prior.actorId !== actor.id ||
            prior.requestHash !== requestHash ||
            prior.status !== "completed"
          )
            throw new ORPCError("CONFLICT", {
              message:
                "This operation was already attempted. Refresh its status before continuing.",
            });
          return false;
        }
        await work(tx);
        await tx.adminAudit.create({
          data: {
            actorId: actor.id,
            action,
            targetId,
            reason: input.reason,
            status,
            requestId: input.requestId,
            requestHash,
          },
        });
        return true;
      }),
    );
  }

  return os.router({
    status: os.status.handler(async ({ context }) => {
      const { user, fresh } = await identity(prisma, context);
      const allowed =
        user.adminRole === "admin" && Boolean(user.emailVerified || user.adminVerifiedAt);
      const settings = await prisma.deploymentSettings.findUnique({
        where: { id: "default" },
        select: { adminBootstrapConsumedAt: true },
      });
      const canClaim =
        !allowed &&
        bootstrapEmails.has(emailKey(user.email)) &&
        (user.emailVerified ||
          Boolean(config.bootstrapTokenHash && !settings?.adminBootstrapConsumedAt));
      return { allowed, canClaim, needsClaimCode: canClaim && !user.emailVerified, fresh };
    }),
    claim: os.claim.handler(async ({ context, input }) => {
      await withTransactionRetry(() =>
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM deployment_settings WHERE id = 'default' FOR UPDATE`;
          const { user, fresh } = await identity(tx as Db, context);
          if (!fresh || !bootstrapEmails.has(emailKey(user.email)))
            throw new ORPCError("FORBIDDEN");
          if (!user.emailVerified) {
            const expected = config.bootstrapTokenHash;
            const actual = createHash("sha256")
              .update(input.code ?? "")
              .digest();
            if (
              !expected ||
              !/^[a-f0-9]{64}$/i.test(expected) ||
              !timingSafeEqual(actual, Buffer.from(expected, "hex"))
            )
              throw new ORPCError("FORBIDDEN");
            const claimed = await tx.deploymentSettings.updateMany({
              where: { id: "default", adminBootstrapConsumedAt: null },
              data: { adminBootstrapConsumedAt: new Date() },
            });
            if (claimed.count !== 1) throw new ORPCError("FORBIDDEN");
          }
          await tx.user.update({
            where: { id: user.id },
            data: { adminRole: "admin", adminVerifiedAt: new Date() },
          });
          await tx.adminAudit.create({
            data: {
              actorId: user.id,
              action: "admin.claim",
              targetId: user.id,
              reason: "Verified administrator bootstrap",
              requestId: input.requestId,
              requestHash: digest({ action: "admin.claim", userId: user.id }),
            },
          });
        }),
      );
      return ok;
    }),
    overview: admin.overview.handler(async () => {
      const since = new Date(Date.now() - 7 * 86400_000);
      const [users, suspendedUsers, bots, activeRuns, activeSchedules, failedRuns7d, usage] =
        await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { suspendedAt: { not: null } } }),
          prisma.bot.count({ where: { archivedAt: null } }),
          prisma.run.count({ where: { status: { in: ACTIVE } } }),
          prisma.routine.count({ where: { active: true } }),
          prisma.run.count({ where: { status: "failed", createdAt: { gte: since } } }),
          prisma.usageRecord.aggregate({
            where: { createdAt: { gte: since } },
            _sum: { inputTokens: true, outputTokens: true },
          }),
        ]);
      return {
        users,
        suspendedUsers,
        bots,
        activeRuns,
        activeSchedules,
        failedRuns7d,
        inputTokens7d: usage._sum.inputTokens ?? 0,
        outputTokens7d: usage._sum.outputTokens ?? 0,
        billingConfigured: Boolean(config.billing),
      };
    }),
    users: admin.users.handler(async ({ input }) => {
      const rows = await prisma.user.findMany({
        ...paginate(input),
        where: input.query
          ? {
              OR: [
                { email: { contains: input.query, mode: "insensitive" } },
                { name: { contains: input.query, mode: "insensitive" } },
              ],
            }
          : {},
      });
      return result(rows.map(userDto));
    }),
    user: admin.user.handler(async ({ input }) => {
      const user = await prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new ORPCError("NOT_FOUND");
      const [bots, usage, sessions, connections] = await Promise.all([
        prisma.bot.count({ where: { userId: user.id, archivedAt: null } }),
        prisma.usageRecord.aggregate({
          where: { userId: user.id },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        prisma.session.findMany({
          where: { userId: user.id, expiresAt: { gt: new Date() } },
          take: 50,
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, expiresAt: true },
        }),
        prisma.connection.findMany({
          where: { userId: user.id },
          take: 100,
          orderBy: { createdAt: "desc" },
          select: { id: true, provider: true, displayName: true, status: true, userRevoked: true },
        }),
      ]);
      return {
        user: userDto(user),
        bots,
        inputTokens: usage._sum.inputTokens ?? 0,
        outputTokens: usage._sum.outputTokens ?? 0,
        sessions: sessions.map((row) => ({
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        })),
        connections: connections.map(({ userRevoked, ...row }) => ({
          ...row,
          status: userRevoked ? "revoked" : row.status,
        })),
        billingCustomerId: user.billingCustomerId,
      };
    }),
    userAction: admin.userAction.handler(async ({ context, input }) => {
      await mutate(context, input, `user.${input.action}`, input.userId, async (tx) => {
        const target = await tx.user.findUnique({ where: { id: input.userId } });
        if (!target) throw new ORPCError("NOT_FOUND");
        if (
          ["suspend", "demote"].includes(input.action) &&
          (target.id === context.actor!.userId || bootstrapEmails.has(emailKey(target.email)))
        )
          throw new ORPCError("FORBIDDEN", {
            message: "This administrator is protected from suspension or removal.",
          });
        if (input.action === "promote" && !target.emailVerified)
          throw new ORPCError("BAD_REQUEST", {
            message: "The user must verify their email before becoming an administrator.",
          });
        if (input.action === "promote" || input.action === "demote")
          await tx.user.update({
            where: { id: target.id },
            data: {
              adminRole: input.action === "promote" ? "admin" : "member",
              adminVerifiedAt: input.action === "promote" ? new Date() : null,
            },
          });
        if (input.action === "suspend" || input.action === "reactivate")
          await tx.user.update({
            where: { id: target.id },
            data: { suspendedAt: input.action === "suspend" ? new Date() : null },
          });
        if (["suspend", "demote", "revoke_sessions"].includes(input.action))
          await tx.session.deleteMany({ where: { userId: target.id } });
        if (["suspend", "pause_schedules"].includes(input.action))
          await tx.routine.updateMany({
            where: { userId: target.id },
            data: { active: false, nextRunAt: null },
          });
        if (["suspend", "stop_runs"].includes(input.action))
          await cancelUserRuns(tx, { userId: target.id });
      });
      return ok;
    }),
    runs: admin.runs.handler(async ({ input }) => {
      const rows = await prisma.run.findMany({
        ...paginate(input),
        where: {
          ...(input.status === "active"
            ? { status: { in: ACTIVE } }
            : input.status === "failed"
              ? { status: "failed" }
              : {}),
          ...(input.query
            ? {
                OR: [
                  { id: { contains: input.query } },
                  { userId: { contains: input.query } },
                  { bot: { name: { contains: input.query, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          userId: true,
          status: true,
          trigger: true,
          createdAt: true,
          guardrailState: true,
          bot: { select: { name: true } },
        },
      });
      return result(
        rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          botName: row.bot.name,
          status: row.status,
          trigger: row.trigger,
          createdAt: row.createdAt.toISOString(),
          toolCalls: Number((row.guardrailState as { count?: number } | null)?.count ?? 0),
        })),
      );
    }),
    stopRun: admin.stopRun.handler(async ({ context, input }) => {
      await mutate(context, input, "run.stop", input.runId, async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: input.runId },
          select: { userId: true },
        });
        if (!run) throw new ORPCError("NOT_FOUND");
        await cancelUserRuns(tx, { id: input.runId, userId: run.userId });
      });
      return ok;
    }),
    schedules: admin.schedules.handler(async ({ input }) => {
      const rows = await prisma.routine.findMany({
        ...paginate(input),
        where: input.query
          ? {
              OR: [
                { name: { contains: input.query, mode: "insensitive" } },
                { userId: { contains: input.query } },
              ],
            }
          : {},
        select: {
          id: true,
          userId: true,
          name: true,
          active: true,
          crons: true,
          timezone: true,
          nextRunAt: true,
          lastRunAt: true,
        },
      });
      return result(
        rows.map((row) => ({
          ...row,
          nextRunAt: iso(row.nextRunAt),
          lastRunAt: iso(row.lastRunAt),
        })),
      );
    }),
    scheduleAction: admin.scheduleAction.handler(async ({ context, input }) => {
      await mutate(
        context,
        input,
        input.active ? "schedule.resume" : "schedule.pause",
        input.routineId,
        async (tx) => {
          const routine = await tx.routine.findUnique({ where: { id: input.routineId } });
          if (!routine) throw new ORPCError("NOT_FOUND");
          const owner = await tx.user.findUnique({
            where: { id: routine.userId },
            select: { suspendedAt: true },
          });
          if (input.active && (!owner || owner.suspendedAt)) throw new ORPCError("FORBIDDEN");
          let nextRunAt: Date | null = null;
          if (input.active) {
            try {
              nextRunAt = nextCronDateAcrossStrict(routine.crons, new Date(), routine.timezone);
            } catch {
              /* Invalid legacy schedule. */
            }
            if (!nextRunAt)
              throw new ORPCError("BAD_REQUEST", {
                message: "Edit this schedule before resuming it.",
              });
          }
          await tx.routine.update({
            where: { id: routine.id },
            data: { active: input.active, nextRunAt },
          });
        },
      );
      const current = await prisma.routine.findUniqueOrThrow({ where: { id: input.routineId } });
      if (current.active && current.nextRunAt)
        await jobs.enqueue(routineWakeupJob(current.id, current.nextRunAt));
      else await jobs.cancel(routineJobKey(current.id));
      return ok;
    }),
    audit: admin.audit.handler(async ({ input }) => {
      const rows = await prisma.adminAudit.findMany({
        ...paginate(input),
        where: input.query
          ? {
              OR: [
                { action: { contains: input.query } },
                { targetId: { contains: input.query } },
                { actorId: { contains: input.query } },
              ],
            }
          : {},
        select: {
          id: true,
          actorId: true,
          action: true,
          targetId: true,
          reason: true,
          status: true,
          createdAt: true,
        },
      });
      return result(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
    }),
    settings: admin.settings.handler(async () => {
      const row = await prisma.deploymentSettings.findUniqueOrThrow({ where: { id: "default" } });
      return {
        signupsEnabled: row.signupsEnabled,
        signupAllowlist: parseAllowlist(row.signupAllowlist),
      };
    }),
    updateSettings: admin.updateSettings.handler(async ({ context, input }) => {
      await mutate(context, input, "settings.signup", null, async (tx) => {
        if (
          input.signupAllowlist.some(
            (entry) =>
              !/^(?:[^@\s,]+)?@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(
                entry,
              ),
          )
        )
          throw new ORPCError("BAD_REQUEST", {
            message: "Use email addresses or @domain entries in the signup allowlist.",
          });
        await tx.deploymentSettings.update({
          where: { id: "default" },
          data: {
            signupsEnabled: input.signupsEnabled,
            signupAllowlist: input.signupAllowlist.join(","),
            signupPolicyInitialized: true,
          },
        });
      });
      return ok;
    }),
    billing: admin.billing.handler(async ({ context, input }) => {
      if (!config.billing) return { configured: false, snapshot: null };
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { billingCustomerId: true },
      });
      if (!user) throw new ORPCError("NOT_FOUND");
      return {
        configured: true,
        snapshot: user.billingCustomerId
          ? await config.billing.customer(user.billingCustomerId, context.signal)
          : null,
      };
    }),
    linkBilling: admin.linkBilling.handler(async ({ context, input }) => {
      await requireAdmin(prisma, context, true);
      if (!config.billing)
        throw new ORPCError("BAD_REQUEST", { message: "Billing is not connected." });
      const snapshot = await config.billing.customer(input.customerId, context.signal);
      await mutate(context, input, "billing.link", input.userId, async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
        if (!snapshot.email || emailKey(snapshot.email) !== emailKey(user.email))
          throw new ORPCError("BAD_REQUEST", {
            message: "The billing customer email must match this user.",
          });
        await tx.user.update({
          where: { id: user.id },
          data: { billingCustomerId: snapshot.customerId },
        });
      });
      return ok;
    }),
    updateSubscription: admin.updateSubscription.handler(async ({ context, input }) => {
      if (!config.billing)
        throw new ORPCError("BAD_REQUEST", { message: "Billing is not connected." });
      let customerId: string | null = null;
      const started = await mutate(
        context,
        input,
        "billing.subscription",
        input.userId,
        async (tx) => {
          customerId = (await tx.user.findUniqueOrThrow({ where: { id: input.userId } }))
            .billingCustomerId;
          if (!customerId)
            throw new ORPCError("BAD_REQUEST", { message: "Link a billing customer first." });
        },
        "pending",
      );
      if (!started) return ok;
      try {
        await config.billing.setCancellation(
          { ...input, customerId: customerId!, operationId: input.requestId },
          context.signal,
        );
        await prisma.adminAudit.update({
          where: { requestId: input.requestId },
          data: { status: "completed" },
        });
      } catch {
        await prisma.adminAudit.update({
          where: { requestId: input.requestId },
          data: { status: "unknown" },
        });
        throw new ORPCError("BAD_GATEWAY", {
          message: "Billing result is unconfirmed. Refresh billing before retrying.",
        });
      }
      return ok;
    }),
  });
}
