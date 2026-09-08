import { oc } from "@orpc/contract";
import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

const page = z.object({
  query: z.string().trim().max(200).default(""),
  cursor: Id.max(200).optional(),
});
const mutation = z.object({
  requestId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
export const AdminUserSchema = z.object({
  id: Id,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(["member", "admin"]),
  suspendedAt: IsoDate.nullable(),
  createdAt: IsoDate,
});
export const BillingSnapshotSchema = z.object({
  customerId: z.string(),
  email: z.string().nullable(),
  dashboardUrl: z.string().url(),
  subscriptions: z.array(
    z.object({ id: z.string(), status: z.string(), cancelAtPeriodEnd: z.boolean() }),
  ),
  invoices: z.array(
    z.object({
      id: z.string(),
      number: z.string().nullable(),
      status: z.string().nullable(),
      amountDue: z.number().int(),
      amountPaid: z.number().int(),
      currency: z.string().regex(/^[a-zA-Z]{3}$/),
      minorUnitDigits: z.number().int().min(0).max(3),
      createdAt: IsoDate,
    }),
  ),
});
export type BillingSnapshot = z.infer<typeof BillingSnapshotSchema>;

export const adminContract = {
  status: oc.output(
    z.object({
      allowed: z.boolean(),
      canClaim: z.boolean(),
      needsClaimCode: z.boolean(),
      fresh: z.boolean(),
    }),
  ),
  claim: oc
    .input(z.object({ code: z.string().max(200).optional(), requestId: z.string().uuid() }))
    .output(z.object({ ok: z.literal(true) })),
  overview: oc.output(
    z.object({
      users: z.number(),
      suspendedUsers: z.number(),
      bots: z.number(),
      activeRuns: z.number(),
      activeSchedules: z.number(),
      failedRuns7d: z.number(),
      inputTokens7d: z.number(),
      outputTokens7d: z.number(),
      billingConfigured: z.boolean(),
    }),
  ),
  users: oc
    .input(page)
    .output(z.object({ items: z.array(AdminUserSchema), nextCursor: Id.nullable() })),
  user: oc.input(z.object({ userId: Id.max(200) })).output(
    z.object({
      user: AdminUserSchema,
      bots: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      sessions: z.array(z.object({ id: Id, createdAt: IsoDate, expiresAt: IsoDate })),
      connections: z.array(
        z.object({ id: Id, provider: z.string(), displayName: z.string(), status: z.string() }),
      ),
      billingCustomerId: z.string().nullable(),
    }),
  ),
  userAction: oc
    .input(
      mutation.extend({
        userId: Id.max(200),
        action: z.enum([
          "suspend",
          "reactivate",
          "revoke_sessions",
          "promote",
          "demote",
          "pause_schedules",
          "stop_runs",
        ]),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
  runs: oc
    .input(page.extend({ status: z.enum(["active", "failed", "all"]).default("active") }))
    .output(
      z.object({
        items: z.array(
          z.object({
            id: Id,
            userId: Id,
            botName: z.string(),
            status: z.string(),
            trigger: z.string(),
            createdAt: IsoDate,
            toolCalls: z.number(),
          }),
        ),
        nextCursor: Id.nullable(),
      }),
    ),
  stopRun: oc
    .input(mutation.extend({ runId: Id.max(200) }))
    .output(z.object({ ok: z.literal(true) })),
  schedules: oc.input(page).output(
    z.object({
      items: z.array(
        z.object({
          id: Id,
          userId: Id,
          name: z.string(),
          active: z.boolean(),
          crons: z.array(z.string()),
          timezone: z.string(),
          nextRunAt: IsoDate.nullable(),
          lastRunAt: IsoDate.nullable(),
        }),
      ),
      nextCursor: Id.nullable(),
    }),
  ),
  scheduleAction: oc
    .input(mutation.extend({ routineId: Id.max(200), active: z.boolean() }))
    .output(z.object({ ok: z.literal(true) })),
  audit: oc.input(page).output(
    z.object({
      items: z.array(
        z.object({
          id: Id,
          actorId: Id,
          action: z.string(),
          targetId: z.string().nullable(),
          reason: z.string(),
          status: z.string(),
          createdAt: IsoDate,
        }),
      ),
      nextCursor: Id.nullable(),
    }),
  ),
  settings: oc.output(
    z.object({ signupsEnabled: z.boolean(), signupAllowlist: z.array(z.string()) }),
  ),
  updateSettings: oc
    .input(
      mutation.extend({
        signupsEnabled: z.boolean(),
        signupAllowlist: z.array(z.string().trim().min(1).max(254)).max(100),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
  billing: oc
    .input(z.object({ userId: Id.max(200) }))
    .output(z.object({ configured: z.boolean(), snapshot: BillingSnapshotSchema.nullable() })),
  linkBilling: oc
    .input(
      mutation.extend({
        userId: Id.max(200),
        customerId: z
          .string()
          .regex(/^cus_[A-Za-z0-9]+$/)
          .max(100),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
  updateSubscription: oc
    .input(
      mutation.extend({
        userId: Id.max(200),
        subscriptionId: z
          .string()
          .regex(/^sub_[A-Za-z0-9]+$/)
          .max(100),
        cancelAtPeriodEnd: z.boolean(),
      }),
    )
    .output(z.object({ ok: z.literal(true) })),
};
