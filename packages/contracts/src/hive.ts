import * as z from "zod";
import { Id } from "./ids.js";

/**
 * A hive is a group chat bound to one project. Its bots hold roles; the server owns the goal
 * contract, the work graph, dispatch, evidence and review. See docs/hives.md.
 */
export const HIVE_MEMBER_MAX = 24;
export const HIVE_TASK_MAX = 200;
export const HIVE_REWORK_MAX = 2;
export const HIVE_DEFAULT_BUDGET_TOKENS = 2_000_000;
export const HIVE_MAX_BUDGET_TOKENS = 2_000_000_000;

export const HIVE_ROLES = ["leader", "orchestrator", "auditor", "worker", "observer"] as const;
export const HiveRoleSchema = z.enum(HIVE_ROLES);
export type HiveRole = z.infer<typeof HiveRoleSchema>;

export const HiveStatusSchema = z.enum(["planning", "running", "paused", "accepted", "cancelled"]);
export type HiveStatus = z.infer<typeof HiveStatusSchema>;

export const HiveTaskStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "in_review",
  "rework",
  "accepted",
  "failed",
  "blocked",
  "cancelled",
]);
export type HiveTaskStatus = z.infer<typeof HiveTaskStatusSchema>;

export const HiveEvidenceKindSchema = z.enum(["file", "test", "run", "link", "artifact", "note"]);
export type HiveEvidenceKind = z.infer<typeof HiveEvidenceKindSchema>;

export const HiveVerdictSchema = z.enum(["accept", "rework", "reject"]);
export type HiveVerdict = z.infer<typeof HiveVerdictSchema>;

const Line = z.string().trim().min(1).max(500);

export const HiveGoalSchema = z.object({
  summary: z.string().trim().max(1000).default(""),
  targetState: z.string().trim().max(2000).default(""),
  successMetrics: z.array(Line).max(20).default([]),
  acceptance: z.array(Line).max(30).default([]),
  constraints: z.array(Line).max(30).default([]),
  nonGoals: z.array(Line).max(30).default([]),
  deadline: z.string().datetime({ offset: true }).optional(),
});
export type HiveGoal = z.infer<typeof HiveGoalSchema>;

/** Informational link to an external project. The desktop app owns the sync. */
export const HiveExternalSchema = z.object({
  provider: z.literal("operate"),
  workspaceId: z.string().max(200).optional(),
  projectId: z.string().max(200).optional(),
  taskId: z.string().max(200).optional(),
  url: z.string().url().max(2000).optional(),
});
export type HiveExternal = z.infer<typeof HiveExternalSchema>;

export const HiveSchema = z.object({
  id: Id,
  groupId: Id,
  /** The hive's chat thread; hive events arrive on it. */
  threadId: Id,
  spaceId: Id,
  name: z.string(),
  goal: HiveGoalSchema,
  status: HiveStatusSchema,
  /** 0 to 5, see docs/hives.md. */
  realityLevel: z.number().int().min(0).max(5),
  budgetTokens: z.number().int().positive(),
  /** Tokens used so far by runs in the hive thread. */
  spentTokens: z.number().int().nonnegative(),
  external: HiveExternalSchema.nullable(),
  /** Increases on every change to the hive or its tasks. */
  seq: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Hive = z.infer<typeof HiveSchema>;

export const HiveMemberSchema = z.object({ botId: Id, role: HiveRoleSchema });
export type HiveMember = z.infer<typeof HiveMemberSchema>;

export const HiveAcceptanceItemSchema = z.object({ id: z.string(), text: z.string() });

export const HiveEvidenceSchema = z.object({
  id: Id,
  taskId: Id,
  kind: HiveEvidenceKindSchema,
  ref: z.string(),
  summary: z.string(),
  sha256: z.string().nullable(),
  authorBotId: Id,
  runId: z.string().nullable(),
  createdAt: z.string(),
});
export type HiveEvidence = z.infer<typeof HiveEvidenceSchema>;

export const HiveReceiptSchema = z.object({
  id: Id,
  taskId: Id,
  auditorBotId: Id,
  verdict: HiveVerdictSchema,
  notes: z.string(),
  scores: z.record(z.string(), z.number()).nullable(),
  createdAt: z.string(),
});
export type HiveReceipt = z.infer<typeof HiveReceiptSchema>;

export const HiveTaskSchema = z.object({
  id: Id,
  hiveId: Id,
  key: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  brief: z.string(),
  acceptance: z.array(HiveAcceptanceItemSchema),
  ownership: z.array(z.string()),
  dependsOn: z.array(Id),
  assigneeBotId: z.string().nullable(),
  creatorBotId: z.string().nullable(),
  status: HiveTaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  runId: z.string().nullable(),
  claimLeaseUntil: z.string().nullable(),
  seq: z.number().int().nonnegative(),
  evidence: z.array(HiveEvidenceSchema),
  latestReceipt: HiveReceiptSchema.nullable(),
  updatedAt: z.string(),
});
export type HiveTask = z.infer<typeof HiveTaskSchema>;

export const HiveDetailSchema = z.object({
  hive: HiveSchema,
  members: z.array(HiveMemberSchema),
  tasks: z.array(HiveTaskSchema),
});
export type HiveDetail = z.infer<typeof HiveDetailSchema>;

const hiveMembers = z
  .array(HiveMemberSchema)
  .min(2)
  .max(HIVE_MEMBER_MAX)
  .refine((members) => new Set(members.map((member) => member.botId)).size === members.length, {
    error: "botIds must be distinct",
  });

/** A hive has at most one leader and one orchestrator; the other roles may repeat. */
export function hiveRolesError(members: ReadonlyArray<{ role: HiveRole }>): string | null {
  for (const role of ["leader", "orchestrator"] as const) {
    if (members.filter((member) => member.role === role).length > 1) {
      return `A hive has at most one ${role}`;
    }
  }
  return null;
}

const rolesValid = (members: ReadonlyArray<{ role: HiveRole }>) => hiveRolesError(members) === null;

export const CreateHiveInput = z.object({
  name: z.string().trim().min(1).max(80),
  members: hiveMembers.refine(rolesValid, { error: "A hive has one leader and one orchestrator" }),
  goal: HiveGoalSchema.optional(),
  budgetTokens: z.number().int().positive().max(HIVE_MAX_BUDGET_TOKENS).optional(),
});
export type CreateHiveInput = z.infer<typeof CreateHiveInput>;

export const HiveFromGroupInput = z.object({
  groupId: Id,
  roles: hiveMembers.refine(rolesValid, { error: "A hive has one leader and one orchestrator" }),
  goal: HiveGoalSchema.optional(),
  budgetTokens: z.number().int().positive().max(HIVE_MAX_BUDGET_TOKENS).optional(),
});
export type HiveFromGroupInput = z.infer<typeof HiveFromGroupInput>;

export const UpdateHiveInput = z.object({
  hiveId: Id,
  goal: HiveGoalSchema.optional(),
  /** The user may move a hive between planning, running and paused; `cancelled` ends it. */
  status: z.enum(["planning", "running", "paused", "cancelled"]).optional(),
  budgetTokens: z.number().int().positive().max(HIVE_MAX_BUDGET_TOKENS).optional(),
  external: HiveExternalSchema.nullable().optional(),
});
export type UpdateHiveInput = z.infer<typeof UpdateHiveInput>;

export const HiveSetRoleInput = z.object({ hiveId: Id, botId: Id, role: HiveRoleSchema });
export type HiveSetRoleInput = z.infer<typeof HiveSetRoleInput>;

/** Payload of the `hive.updated` thread event. */
export const HiveUpdatedPayloadSchema = z.object({ hive: HiveSchema });
/** Payload of the `hive.task.updated` thread event. */
export const HiveTaskUpdatedPayloadSchema = z.object({ task: HiveTaskSchema });
