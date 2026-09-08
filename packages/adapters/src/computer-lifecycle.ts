import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type {
  AdapterContext,
  AgentHomeStore,
  ComputerRef,
  JobPublisher,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { ACTIVE_RUN_STATUSES, screenLeaseId } from "@rakazo/core";
import {
  expireComputerExecutionLeases,
  type Prisma,
  type PrismaClient,
  parseComputerMode,
  type ThreadEvents,
} from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import {
  clearInactiveUserComputerControl,
  expireComputerControl,
  hasActiveComputerControl,
} from "./computer-control.js";
import { toComputerRef } from "./computer-support.js";
import {
  cachedWorkspaceSnapshot,
  checkpointAndRecordComputerWorkspace,
  ensureComputerWorkspaceLayout,
  restoreComputerWorkspace,
} from "./computer-workspace.js";
import { isUnrecoverableSandboxError } from "./e2b-sandbox.js";
import { resolveAgentHomePath } from "./home.js";

const EXECUTION_LEASE_MS = 5 * 60_000;
const RELEASED_EXECUTION_LEASE_AT = new Date(0);
const BOOT_WAIT_TIMEOUT_MS = 180_000;
const BOOT_WAIT_MS = 250;

export const COMPUTER_STARTUP_LEASE_MS = 210_000;
export const COMPUTER_STARTUP_TIMEOUT_MS = 150_000;
export const COMPUTER_STARTUP_MAX_ATTEMPTS = 3;
export function expiredComputerStartupWhere(now: Date): Prisma.ComputerWhereInput {
  return {
    OR: [
      { state: "booting" },
      { state: "suspending", startupOperationId: { not: null }, startupRequestedAt: { not: null } },
    ],
    AND: [
      {
        OR: [
          { startupExpiresAt: { lte: now } },
          {
            startupExpiresAt: null,
            updatedAt: { lte: new Date(now.getTime() - COMPUTER_STARTUP_LEASE_MS) },
          },
        ],
      },
    ],
  };
}
export function hasActiveComputerStartupOperation(
  computer: {
    state?: string;
    startupOperationId?: string | null;
    startupExpiresAt?: Date | null;
    startupDrainUntil?: Date | null;
  },
  now = Date.now(),
) {
  return Boolean(
    (computer.startupOperationId &&
      computer.startupExpiresAt &&
      computer.startupExpiresAt.getTime() > now) ||
      (!["booting", "suspending"].includes(computer.state ?? "") &&
        computer.startupDrainUntil &&
        computer.startupDrainUntil.getTime() > now),
  );
}
export function isComputerStartupExpired(
  computer: {
    state: string;
    startupExpiresAt?: Date | null;
    startupOperationId?: string | null;
    startupRequestedAt?: Date | null;
    updatedAt?: Date;
  },
  now = Date.now(),
) {
  return (
    (computer.state === "booting" ||
      (computer.state === "suspending" &&
        Boolean(computer.startupOperationId && computer.startupRequestedAt))) &&
    (computer.startupExpiresAt
      ? computer.startupExpiresAt.getTime() <= now
      : Boolean(
          computer.updatedAt && computer.updatedAt.getTime() <= now - COMPUTER_STARTUP_LEASE_MS,
        ))
  );
}
async function startupStep<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new Error("Computer startup timed out"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export class ComputerBusyError extends Error {
  constructor() {
    super("Computer is busy");
    this.name = "ComputerBusyError";
  }
}

export class ComputerNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerNotReadyError";
  }
}

export { toComputerRef } from "./computer-support.js";

export async function provisionComputer(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    home: AgentHomeStore;
    jobs: JobPublisher;
    events: ThreadEvents;
    dataDir?: string;
  },
  computerId: string,
  context: AdapterContext,
  controlHolder: "bot" | "none" = "none",
  expectedVersion?: Date,
): Promise<ComputerRef> {
  let existing = await deps.prisma.computer.findUniqueOrThrow({
    where: { id: computerId },
  });
  if (existing.controlLeaseId && !hasActiveComputerControl(existing)) {
    await expireComputerControl(deps, existing.id, existing.controlLeaseId);
    existing = await deps.prisma.computer.findUniqueOrThrow({
      where: { id: computerId },
    });
    if (existing.controlLeaseId && !hasActiveComputerControl(existing)) {
      throw new Error("computer control revocation is still in progress");
    }
  }
  const expired = isComputerStartupExpired(existing);
  if (
    !["booting", "suspending"].includes(existing.state) &&
    hasActiveComputerStartupOperation(existing)
  )
    throw new ComputerBusyError();
  const sameRequest =
    expectedVersion && existing.startupRequestedAt?.getTime() === expectedVersion.getTime();
  if (expectedVersion && existing.updatedAt.getTime() !== expectedVersion.getTime() && !sameRequest)
    throw new ComputerBusyError();
  if (expectedVersion && (existing.startupAttempts ?? 0) >= COMPUTER_STARTUP_MAX_ATTEMPTS)
    throw new ComputerNotReadyError(
      "Computer startup failed repeatedly. Open the computer to retry.",
    );
  const homePath = resolveAgentHomePath(deps.home, existing.homeKey, deps.dataDir ?? "./data");
  await mkdir(homePath, { recursive: true });
  if (existing.state === "running" && existing.providerRef)
    return reconnectComputer(deps, existing, homePath, context);
  if (expectedVersion && existing.state === "booting" && !expired) throw new ComputerBusyError();
  if ((existing.state === "booting" && !expired) || (existing.state === "suspending" && !expired)) {
    const ready = await waitForComputerReady(deps.prisma, computerId, context);
    return reconnectComputer(deps, ready, homePath, context);
  }
  const operationId = randomUUID();
  const now = new Date();
  const requestedAt =
    expectedVersion ??
    (expired ? existing.startupRequestedAt : undefined) ??
    existing.updatedAt ??
    now;
  const claimed = await deps.prisma.computer.updateMany({
    where: {
      id: computerId,
      AND: [
        {
          OR: [
            { state: { in: ["booting", "suspending"] } },
            { startupDrainUntil: null },
            { startupDrainUntil: { lte: now } },
          ],
        },
        {
          OR: [
            { startupOperationId: null },
            { startupExpiresAt: null },
            { startupExpiresAt: { lte: now } },
          ],
        },
        expired
          ? expiredComputerStartupWhere(now)
          : { state: { in: ["stopped", "suspended", "error"] } },
        ...(expectedVersion
          ? [
              {
                OR: [{ updatedAt: expectedVersion }, { startupRequestedAt: expectedVersion }],
                startupAttempts: { lt: COMPUTER_STARTUP_MAX_ATTEMPTS },
              },
            ]
          : []),
      ],
      ...(context.botId
        ? { bots: { some: { id: context.botId, archivedAt: null, computerSwitching: false } } }
        : {}),
    },
    data: {
      state: "booting",
      startupOperationId: operationId,
      startupExpiresAt: new Date(now.getTime() + COMPUTER_STARTUP_LEASE_MS),
      startupDrainUntil: new Date(now.getTime() + COMPUTER_STARTUP_LEASE_MS),
      startupRequestedAt: requestedAt,
      startupBotId: context.botId ?? null,
      startupAttempts: expectedVersion || expired ? { increment: 1 } : 1,
    },
  });
  if (claimed.count !== 1) {
    if (expectedVersion) throw new ComputerBusyError();
    const ready = await waitForComputerReady(deps.prisma, computerId, context);
    return reconnectComputer(deps, ready, homePath, context);
  }
  const remainingMs = COMPUTER_STARTUP_TIMEOUT_MS - (Date.now() - now.getTime());
  const deadlineSignal =
    remainingMs > 0
      ? AbortSignal.timeout(remainingMs)
      : AbortSignal.abort(new Error("Computer startup deadline expired before provisioning"));
  const startupContext = { ...context, signal: AbortSignal.any([context.signal, deadlineSignal]) };
  const owned = () => ({
    id: computerId,
    state: "booting",
    startupOperationId: operationId,
    startupExpiresAt: { gt: new Date() },
  });
  const retain = async (data: Prisma.ComputerUpdateManyMutationInput) => {
    startupContext.signal.throwIfAborted();
    const result = await startupStep(
      deps.prisma.computer.updateMany({
        where: {
          ...owned(),
          ...(context.botId
            ? { bots: { some: { id: context.botId, archivedAt: null, computerSwitching: false } } }
            : {}),
        },
        data,
      }),
      startupContext.signal,
    );
    if (result.count !== 1) throw new ComputerBusyError();
  };
  let provisioned: ComputerRef | undefined;
  let providerReturned = false;
  let referenceRetained = false;
  let failureRecorded = false;
  let lateProvider: ComputerRef | undefined;
  const settleLateProvider = async (ref: ComputerRef) => {
    const cleanupId = randomUUID();
    const at = new Date();
    const cleanup = await deps.prisma.computer.updateMany({
      where: {
        id: computerId,
        state: { in: ["stopped", "error"] },
        providerRef: existing.providerRef,
        OR: [
          { startupOperationId: operationId },
          { startupOperationId: null },
          { startupExpiresAt: { lte: at } },
        ],
      },
      data: {
        state: "error",
        providerRef: ref.providerRef,
        kind: ref.kind,
        workspaceRestorePending:
          existing.workspaceRestorePending ||
          (!ref.workspaceRestored && ref.providerRef !== existing.providerRef),
        startupOperationId: cleanupId,
        startupExpiresAt: new Date(at.getTime() + 90_000),
        startupBotId: null,
      },
    });
    if (cleanup.count !== 1) {
      getLogger().warn("computer.startup.late_provider_requires_reconciliation");
      return;
    }
    let stopped = false;
    try {
      await startupStep(
        deps.sandbox.stop(ref, { ...context, signal: AbortSignal.timeout(30_000) }),
        AbortSignal.timeout(30_000),
      );
      stopped = true;
    } finally {
      await deps.prisma.computer.updateMany({
        where: { id: computerId, startupOperationId: cleanupId },
        data: {
          state: stopped ? "stopped" : "error",
          ...(stopped
            ? { startupOperationId: null, startupExpiresAt: null, startupDrainUntil: null }
            : {}),
        },
      });
    }
  };
  try {
    startupContext.signal.throwIfAborted();
    const provisioning = deps.sandbox.provision(
      {
        botId: existing.homeKey,
        homePath,
        providerRef:
          deps.sandbox.describe?.().capabilities.persistentRunning &&
          existing.kind !== deps.sandbox.describe().id &&
          ["stopped", "suspended"].includes(existing.state)
            ? undefined
            : (existing.providerRef ?? undefined),
        providerKind: existing.kind as ComputerRef["kind"],
        workspaceSnapshot: await startupStep(
          cachedWorkspaceSnapshot(deps.home, deps.sandbox, existing.homeKey, startupContext),
          startupContext.signal,
        ),
      },
      startupContext,
    );
    void provisioning.then(
      (lateRef) => {
        providerReturned = true;
        if (startupContext.signal.aborted) {
          lateProvider = lateRef;
          if (failureRecorded)
            void settleLateProvider(lateRef).catch(() =>
              getLogger().warn("computer.startup.late_provider_cleanup_failed"),
            );
        }
      },
      () => {},
    );
    const ref = await startupStep(provisioning, startupContext.signal);
    provisioned = ref;
    // Persist the reference before readiness, layout, or restoration can fail.
    const replacement =
      existing.workspaceRestorePending ||
      ref.fresh === true ||
      !existing.providerRef ||
      existing.providerRef !== ref.providerRef ||
      existing.kind !== ref.kind;
    await retain({
      providerRef: ref.providerRef,
      kind: ref.kind,
      workspaceRestorePending:
        existing.workspaceRestorePending || (replacement && !ref.workspaceRestored),
    });
    referenceRetained = true;
    await startupStep(deps.sandbox.prepare(ref, startupContext), startupContext.signal);
    if (replacement) {
      await retain({ startupOperationId: operationId });
      await startupStep(
        restoreComputerWorkspace(
          deps.home,
          deps.sandbox,
          existing.homeKey,
          existing.workspaceRestorePending ? { ...ref, workspaceRestored: false } : ref,
          startupContext,
        ),
        startupContext.signal,
      );
    }
    await retain({ startupOperationId: operationId });
    await startupStep(
      ensureComputerWorkspaceLayout(
        deps.sandbox,
        ref,
        parseComputerMode(existing.scope),
        context.botId,
        startupContext,
      ),
      startupContext.signal,
    );
    const activeControl = hasActiveComputerControl(existing);
    await retain({
      state: "running",
      workspaceRestorePending: false,
      startupDrainUntil: null,
      startupOperationId: null,
      startupExpiresAt: null,
      startupBotId: null,
      controlHolder: activeControl ? "user" : controlHolder,
      ...(!activeControl
        ? {
            controlLeaseId: null,
            controlLeaseExpiresAt: null,
            controlBotId: null,
            controlRunId: null,
          }
        : {}),
    });
    return ref;
  } catch (error) {
    // No provider rollback here: a late/stale worker must never stop or destroy
    // a VM a successor may have adopted. The early reference remains recoverable.
    const recorded = await deps.prisma.computer.updateMany({
      where: owned(),
      data: {
        state: "error",
        ...(!startupContext.signal.aborted
          ? { startupOperationId: null, startupExpiresAt: null, startupDrainUntil: null }
          : {}),
        startupBotId: null,
      },
    });
    failureRecorded = true;
    if (!referenceRetained && (provisioned || lateProvider)) {
      await settleLateProvider((provisioned || lateProvider)!).catch(() =>
        getLogger().warn("computer.startup.late_provider_cleanup_failed"),
      );
    }
    if (recorded.count !== 1 && (provisioned || providerReturned))
      getLogger().warn("computer.startup.reference_requires_reconciliation");
    throw error;
  }
}

async function reconnectComputer(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    home: AgentHomeStore;
    dataDir?: string;
  },
  computer: {
    id: string;
    homeKey: string;
    providerRef: string | null;
    kind: string;
    scope: string;
  },
  homePath: string,
  context: AdapterContext,
): Promise<ComputerRef> {
  const ref = await deps.sandbox.provision(
    {
      botId: computer.homeKey,
      homePath,
      providerRef: computer.providerRef ?? undefined,
      providerKind: computer.kind as ComputerRef["kind"],
      workspaceSnapshot: await cachedWorkspaceSnapshot(
        deps.home,
        deps.sandbox,
        computer.homeKey,
        context,
      ),
    },
    context,
  );
  const changedProvider = ref.providerRef !== computer.providerRef || ref.kind !== computer.kind;
  const needsWorkspaceRestore = ref.fresh === true || changedProvider;
  const ownsRef = ref.fresh === true;
  try {
    await deps.sandbox.prepare(ref, context);
    if (needsWorkspaceRestore) {
      await restoreComputerWorkspace(deps.home, deps.sandbox, computer.homeKey, ref, context);
    }
    await ensureComputerWorkspaceLayout(
      deps.sandbox,
      ref,
      parseComputerMode(computer.scope),
      context.botId,
      context,
    );
    if (changedProvider) {
      await deps.prisma.computer.update({
        where: { id: computer.id },
        data: {
          providerRef: ref.providerRef,
          kind: ref.kind,
        },
      });
    }
  } catch (error) {
    // Only tear down a sandbox this reconnect created. A pre-existing ref
    // (fresh: false) may belong to the user even when providerRef changed.
    const rollbackError = ownsRef
      ? await rollbackProvisionedComputer(deps.sandbox, ref, context)
      : undefined;
    if (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Computer reconnection failed and its replacement could not be rolled back",
      );
    }
    throw error;
  }
  return ref;
}

/** Join an existing startup without taking its execution lease or restarting a later Stop. */
export async function waitForComputerReady(
  prisma: PrismaClient,
  computerId: string,
  context: AdapterContext,
  options: { waitForStart?: boolean } = {},
) {
  const deadline = Date.now() + BOOT_WAIT_TIMEOUT_MS;
  let initialVersion: number | undefined;
  let initialState: string | undefined;
  let started = false;
  for (;;) {
    context.signal.throwIfAborted();
    const current = await prisma.computer.findUniqueOrThrow({
      where: {
        id: computerId,
        ...(context.botId ? { bots: { some: { id: context.botId, archivedAt: null } } } : {}),
      },
    });
    if (current.state === "running" && current.providerRef) return current;
    if (isComputerStartupExpired(current))
      throw new ComputerNotReadyError(
        "Computer startup expired. Open the computer again to recover it.",
      );
    initialVersion ??= current.updatedAt?.getTime();
    initialState ??= current.state;
    if (current.state === "booting") started = true;
    else if (
      !options.waitForStart ||
      started ||
      !["stopped", "suspended", "error"].includes(current.state) ||
      current.state !== initialState ||
      current.updatedAt?.getTime() !== initialVersion
    ) {
      throw new ComputerNotReadyError(
        "Computer startup was interrupted. Open the computer again to retry.",
      );
    }
    if (Date.now() >= deadline) {
      throw new ComputerNotReadyError(
        "Computer startup is taking longer than expected. Try opening it again.",
      );
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(context.signal.reason ?? new Error("computer boot aborted"));
      };
      const timer = setTimeout(
        () => {
          context.signal.removeEventListener("abort", abort);
          resolve();
        },
        Math.min(BOOT_WAIT_MS, deadline - Date.now()),
      );
      context.signal.addEventListener("abort", abort, { once: true });
      if (context.signal.aborted) abort();
    });
  }
}

async function rollbackProvisionedComputer(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<unknown | undefined> {
  try {
    await sandbox.releaseScreen?.(computer, context).catch(() => undefined);
    if (computer.fresh) {
      await sandbox.destroy(computer, context);
    } else {
      // A reused machine owns durable user files. Failure to stop during a
      // startup race never authorizes deleting that existing machine/volume.
      await sandbox.stop(computer, context);
    }
    return undefined;
  } catch (error) {
    return error;
  }
}

export interface ComputerExecutionLease {
  computerId: string;
  botId: string;
  runId: string;
  fence: number;
}

export function screenLeaseIdForRun(
  lease: Pick<ComputerExecutionLease, "runId" | "fence"> | null,
  runId: string,
  fence = 0,
): string {
  return screenLeaseId(lease?.runId ?? runId, lease?.fence ?? fence);
}

export async function acquireComputerExecutionLease(
  prisma: PrismaClient,
  input: {
    computerId: string;
    runId: string;
    botId: string;
    resumeHeldLease?: boolean;
  },
): Promise<ComputerExecutionLease | null> {
  const computer = await prisma.computer.findUniqueOrThrow({
    where: { id: input.computerId },
  });
  if (computer.scope !== "team") return null;
  if (computer.state === "suspending") throw new ComputerBusyError();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXECUTION_LEASE_MS);
  const [reclaimed] = await prisma.computerExecutionLease.updateManyAndReturn({
    where: {
      computerId: input.computerId,
      botId: input.botId,
      OR: [{ expiresAt: { lt: now } }, ...(input.resumeHeldLease ? [{ runId: input.runId }] : [])],
    },
    data: {
      runId: input.runId,
      expiresAt,
      fence: { increment: 1 },
    },
    select: { fence: true },
  });
  if (reclaimed) {
    return validateAcquiredComputerLease(prisma, {
      computerId: input.computerId,
      botId: input.botId,
      runId: input.runId,
      fence: reclaimed.fence,
    });
  }
  try {
    const created = await prisma.computerExecutionLease.create({
      data: {
        computerId: input.computerId,
        botId: input.botId,
        runId: input.runId,
        fence: 1,
        expiresAt,
      },
      select: { fence: true },
    });
    return validateAcquiredComputerLease(prisma, {
      computerId: input.computerId,
      botId: input.botId,
      runId: input.runId,
      fence: created.fence,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ComputerBusyError();
    throw error;
  }
}

async function validateAcquiredComputerLease(
  prisma: PrismaClient,
  lease: ComputerExecutionLease,
): Promise<ComputerExecutionLease> {
  const computer = await prisma.computer.findUniqueOrThrow({
    where: { id: lease.computerId },
    select: { state: true },
  });
  if (computer.state !== "suspending") return lease;
  await releaseComputerExecutionLease(prisma, lease);
  throw new ComputerBusyError();
}

export async function renewComputerExecutionLease(
  prisma: PrismaClient,
  lease: ComputerExecutionLease | null,
): Promise<boolean> {
  if (!lease) return true;
  const renewed = await prisma.computerExecutionLease.updateMany({
    where: {
      computerId: lease.computerId,
      botId: lease.botId,
      runId: lease.runId,
      fence: lease.fence,
      expiresAt: { gt: RELEASED_EXECUTION_LEASE_AT },
    },
    data: { expiresAt: new Date(Date.now() + EXECUTION_LEASE_MS) },
  });
  return renewed.count === 1;
}

export async function holdComputerExecutionLeaseForTakeover(
  prisma: PrismaClient,
  lease: ComputerExecutionLease | null,
): Promise<boolean> {
  if (!lease) return true;
  const held = await prisma.computerExecutionLease.updateMany({
    where: {
      computerId: lease.computerId,
      botId: lease.botId,
      runId: lease.runId,
      fence: lease.fence,
      expiresAt: { gt: RELEASED_EXECUTION_LEASE_AT },
    },
    data: { expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
  });
  return held.count === 1;
}

export async function releaseComputerExecutionLease(
  prisma: PrismaClient,
  lease: ComputerExecutionLease | null,
): Promise<void> {
  if (!lease) return;
  // Keep the row as an expired tombstone so the next run for this bot increments
  // its fence. Deleting it resets the fence to 1, which lets a still-open screen
  // session from the previous run reject the new run as stale.
  await expireComputerExecutionLeases(prisma, {
    computerId: lease.computerId,
    botId: lease.botId,
    runId: lease.runId,
    fence: lease.fence,
  });
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export type ComputerReplaceMode = "recover" | "reset" | "update";

export function computerSupportsUpdate(kind: string): boolean {
  return kind !== "desktop";
}

export async function replaceComputer(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    home: AgentHomeStore;
    jobs: JobPublisher;
    events: ThreadEvents;
    dataDir?: string;
  },
  computerId: string,
  mode: ComputerReplaceMode,
  context: AdapterContext,
  controlHolder: "bot" | "none" = "none",
): Promise<ComputerRef> {
  let existing = await deps.prisma.computer.findUniqueOrThrow({
    where: { id: computerId },
  });
  if (existing.controlLeaseId && !hasActiveComputerControl(existing)) {
    const expired = await expireComputerControl(deps, existing.id, existing.controlLeaseId);
    existing = await deps.prisma.computer.findUniqueOrThrow({
      where: { id: computerId },
    });
    // Failed provider revoke keeps the lease for retry; do not wipe it and continue reset.
    if (!expired && existing.controlLeaseId && !hasActiveComputerControl(existing)) {
      throw new Error("computer control revocation is still in progress");
    }
  }
  // Orphaned controlHolder=user with no lease id can be cleared for reset/recover.
  if (
    existing.controlHolder === "user" &&
    !hasActiveComputerControl(existing) &&
    !existing.controlLeaseId
  ) {
    await clearInactiveUserComputerControl(deps.prisma, existing.id);
    existing = await deps.prisma.computer.findUniqueOrThrow({
      where: { id: computerId },
    });
    if (existing.controlHolder === "user" && !hasActiveComputerControl(existing)) {
      throw new Error("computer control revocation is still in progress");
    }
  }
  if (hasActiveComputerStartupOperation(existing)) throw new ComputerBusyError();
  const botId = context.botId;
  if (!botId) throw new Error("computer replacement requires a bot id");
  if (hasActiveComputerControl(existing)) {
    throw new ComputerBusyError();
  }
  if (existing.state === "booting" || existing.state === "suspending") {
    throw new ComputerBusyError();
  }

  const previousState = existing.state;
  const now = new Date();
  const maintenanceId = randomUUID();
  const claimed = await deps.prisma.computer.updateMany({
    where: {
      id: computerId,
      state: previousState,
      AND: [
        {
          OR: [
            { state: { in: ["booting", "suspending"] } },
            { startupDrainUntil: null },
            { startupDrainUntil: { lte: now } },
          ],
        },
        {
          OR: [
            { startupOperationId: null },
            { startupExpiresAt: null },
            { startupExpiresAt: { lte: now } },
          ],
        },
      ],
      executionLeases: {
        none: { botId: { not: botId }, expiresAt: { gt: now } },
      },
      OR: [
        { controlHolder: { not: "user" } },
        { controlLeaseId: null },
        { controlLeaseExpiresAt: null },
        { controlLeaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      state: "suspending",
      startupOperationId: maintenanceId,
      startupExpiresAt: new Date(now.getTime() + COMPUTER_STARTUP_LEASE_MS),
      startupDrainUntil: new Date(now.getTime() + COMPUTER_STARTUP_LEASE_MS),
      startupRequestedAt: now,
      startupBotId: botId,
      startupAttempts: 1,
    },
  });
  if (claimed.count !== 1) throw new ComputerBusyError();
  context = {
    ...context,
    signal: AbortSignal.any([
      context.signal,
      AbortSignal.timeout(Math.max(1, COMPUTER_STARTUP_TIMEOUT_MS - (Date.now() - now.getTime()))),
    ]),
  };
  const maintenanceOwner = () => ({
    id: computerId,
    startupOperationId: maintenanceId,
    startupExpiresAt: { gt: new Date() },
  });
  const step = async <T>(work: () => Promise<T>): Promise<T> => {
    context.signal.throwIfAborted();
    if (Date.now() - now.getTime() >= COMPUTER_STARTUP_TIMEOUT_MS)
      throw new Error("Computer maintenance deadline expired");
    const held = await deps.prisma.computer.updateMany({
      where: maintenanceOwner(),
      data: { startupOperationId: maintenanceId },
    });
    if (held.count !== 1) throw new ComputerBusyError();
    context.signal.throwIfAborted();
    if (Date.now() - now.getTime() >= COMPUTER_STARTUP_TIMEOUT_MS)
      throw new Error("Computer maintenance deadline expired");
    return startupStep(work(), context.signal);
  };
  const activeRun = await deps.prisma.run.findFirst({
    where: {
      status: { in: [...ACTIVE_RUN_STATUSES] },
      bot: { computerId },
    },
    select: { id: true },
  });
  if (activeRun) {
    await deps.prisma.computer.updateMany({
      where: { ...maintenanceOwner(), state: "suspending" },
      data: {
        state: previousState,
        startupOperationId: null,
        startupExpiresAt: null,
        startupDrainUntil: null,
        startupBotId: null,
      },
    });
    throw new ComputerBusyError();
  }

  const oldRef = existing.providerRef ? toComputerRef(existing) : null;
  const requiresFreshCheckpoint = Boolean(
    oldRef && mode !== "reset" && deps.sandbox.describe().capabilities.persistentRunning,
  );
  let resumeWorkspace: (() => Promise<void>) | undefined;
  try {
    if (oldRef && mode === "update" && deps.sandbox.updateImage) {
      let portableCheckpointed = false;
      // Updating the same durable machine preserves its files in place. A
      // stopped persistent VM is already safe and cannot run a live sync.
      if (
        !(await step(async () => deps.sandbox.isStoppedWithPersistentWorkspace?.(oldRef, context)))
      ) {
        resumeWorkspace = await step(async () =>
          deps.sandbox.pauseWorkspaceForStop?.(oldRef, context),
        );
        if (!(await step(async () => deps.sandbox.persistWorkspace?.(oldRef, context)))) {
          await step(() => checkpointAndRecordComputerWorkspace(deps, existing, oldRef, context));
          portableCheckpointed = true;
        }
      }
      const updating = await deps.prisma.computer.updateMany({
        where: {
          ...maintenanceOwner(),
          state: "suspending",
          providerRef: oldRef.providerRef,
        },
        data: { state: "booting" },
      });
      if (updating.count !== 1) throw new ComputerBusyError();
      const updated = await step(() => deps.sandbox.updateImage!(oldRef, context));
      if (updated) {
        if (
          updated.providerRef !== oldRef.providerRef ||
          updated.kind !== oldRef.kind ||
          updated.botId !== oldRef.botId
        )
          throw new Error("Computer update changed workspace identity");
        await step(() => deps.sandbox.prepare(updated, context));
        const activated = await deps.prisma.computer.updateMany({
          where: {
            ...maintenanceOwner(),
            state: "booting",
            providerRef: oldRef.providerRef,
          },
          data: {
            state: "running",
            controlHolder,
            startupOperationId: null,
            startupExpiresAt: null,
            startupDrainUntil: null,
            startupBotId: null,
          },
        });
        if (activated.count !== 1) throw new ComputerBusyError();
        // The updated runtime restarted its browser/session services. A failed
        // update instead reaches catch with the original reference intact.
        resumeWorkspace = undefined;
        return updated;
      }
      // A volume flush is not a portable backup. An unsupported in-place
      // update may replace the machine only after a fresh export succeeds.
      if (!portableCheckpointed) {
        await step(() => checkpointAndRecordComputerWorkspace(deps, existing, oldRef, context));
      }
    } else if (
      oldRef &&
      mode !== "reset" &&
      (existing.state === "running" || requiresFreshCheckpoint)
    ) {
      try {
        if (requiresFreshCheckpoint && existing.state === "running") {
          resumeWorkspace = await step(async () =>
            deps.sandbox.pauseWorkspaceForStop?.(oldRef, context),
          );
        }
        await step(() => checkpointAndRecordComputerWorkspace(deps, existing, oldRef, context));
      } catch (error) {
        // Persistent computers can contain newer files than their last portable
        // backup. Never delete that volume when a fresh checkpoint is unavailable.
        if (requiresFreshCheckpoint || (mode !== "recover" && !isUnrecoverableSandboxError(error)))
          throw error;
      }
    }
    if (oldRef) {
      await deps.sandbox.releaseScreen?.(oldRef, context).catch(() => undefined);
      try {
        await step(() => deps.sandbox.destroy(oldRef, context));
      } catch (error) {
        if (requiresFreshCheckpoint || (mode !== "recover" && !isUnrecoverableSandboxError(error)))
          throw error;
      }
      resumeWorkspace = undefined;
    }
    const released = await deps.prisma.computer.updateMany({
      where: maintenanceOwner(),
      data: {
        state: "stopped",
        startupOperationId: null,
        startupExpiresAt: null,
        startupDrainUntil: null,
        startupBotId: null,
        providerRef: null,
        controlHolder: "none",
        controlLeaseId: null,
        controlLeaseExpiresAt: null,
        controlBotId: null,
        controlRunId: null,
      },
    });
    if (released.count !== 1) throw new ComputerBusyError();
    return provisionComputer(deps, computerId, context, controlHolder);
  } catch (error) {
    let failure = error;
    try {
      if (resumeWorkspace && !context.signal.aborted) await step(resumeWorkspace);
    } catch (resumeError) {
      failure = new AggregateError([error, resumeError], "Computer replacement and resume failed");
    }
    await deps.prisma.computer
      .updateMany({
        where: maintenanceOwner(),
        data: {
          state: "error",
          ...(!context.signal.aborted
            ? { startupOperationId: null, startupExpiresAt: null, startupDrainUntil: null }
            : {}),
          startupBotId: null,
        },
      })
      .catch(() => undefined);
    throw failure;
  }
}
