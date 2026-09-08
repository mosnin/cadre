import type {
  AgentHomeStore,
  AgentRuntime,
  BackgroundJobHandlers,
  ComputerRef,
  JobPublisher,
  MessagingSurface,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { messagingDeliverJob } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { getLogger } from "@rakazo/logging";
import { expireComputerControl } from "./computer-control.js";
import { scheduleComputerSleep, sleepComputerIfIdle } from "./computer-idle.js";
import {
  COMPUTER_STARTUP_MAX_ATTEMPTS,
  ComputerBusyError,
  provisionComputer,
} from "./computer-lifecycle.js";
import type { createRunExecutor } from "./executor.js";
import { compactHistory } from "./history-compaction.js";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import { deliverMessagingOutbound, mirrorMessagingOutbound } from "./messaging-delivery.js";
import type { EncryptedSecretStore } from "./secrets.js";
import { expireTaughtSkillTeaching } from "./teaching-session.js";

export function createBackgroundJobHandlers(deps: {
  executor: ReturnType<typeof createRunExecutor>;
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  jobs: JobPublisher;
  events: ThreadEvents;
  workerId: string;
  runtime: AgentRuntime;
  secretStore: EncryptedSecretStore;
  memoryProviders: MemoryProviderResolver;
  deploymentModelKey?: string;
  messaging?: MessagingSurface;
}): BackgroundJobHandlers {
  const deliverMessaging = async (runId?: string) => {
    if (!deps.messaging) return;
    await deliverMessagingOutbound(
      { prisma: deps.prisma, messaging: deps.messaging, events: deps.events, jobs: deps.jobs },
      { runId },
      {
        operationId: `messaging.deliver:${runId ?? "drain"}`,
        traceId: `messaging.deliver:${runId ?? "drain"}`,
        spaceId: "",
        userId: "",
        signal: new AbortController().signal,
      },
    );
  };

  return {
    "run.continue": async (payload) => {
      await deps.executor.continueRun(payload.runId, deps.workerId);
      // Automatic messaging mirror: once the run's bot messages are durable,
      // copy them into the outbox. Never let mirror failures fail the run.
      if (deps.messaging) {
        await mirrorMessagingOutbound(
          { prisma: deps.prisma, messaging: deps.messaging, events: deps.events, jobs: deps.jobs },
          payload.runId,
        );
        await deps.jobs.enqueue(messagingDeliverJob()).catch(async (error) => {
          getLogger().error("messaging.deliver enqueue error", error);
          await deliverMessaging();
        });
      }
    },
    "messaging.deliver": async (payload) => {
      await deliverMessaging(payload.runId);
    },
    "routine.wakeup": async (payload) => {
      await deps.executor.wakeRoutine(payload.routineId, payload.scheduledFor);
    },
    "computer.warm": async ({ botId, version }) => {
      if (!deps.sandbox.describe().capabilities.persistentRunning) return;
      const bot = await deps.prisma.bot.findUnique({
        where: { id: botId },
        include: { computer: true, thread: true },
      });
      const computer = bot?.computer;
      if (
        !bot ||
        bot.archivedAt ||
        !computer ||
        computer.state === "running" ||
        computer.startupAttempts >= COMPUTER_STARTUP_MAX_ATTEMPTS ||
        (computer.updatedAt.toISOString() !== version &&
          computer.startupRequestedAt?.toISOString() !== version)
      )
        return;
      const context = {
        operationId: "computer.warm",
        traceId: "computer.warm",
        spaceId: bot.spaceId,
        userId: bot.userId,
        botId,
        signal: AbortSignal.timeout(180_000),
      };
      let ref: ComputerRef;
      try {
        ref = await provisionComputer(deps, computer.id, context, "none", new Date(version));
      } catch (error) {
        if (error instanceof ComputerBusyError) return;
        throw error;
      }
      // Infrastructure readiness must not allocate an agent screen using an old
      // screen lease. The authorized viewer/current run binds its own screen.
      void ref;
      scheduleComputerSleep(deps.jobs, computer.id);
      if (bot.thread)
        await deps.events.append({
          spaceId: bot.spaceId,
          threadId: bot.thread!.id,
          botId,
          type: "computer.status",
          payload: { status: "running" },
        });
    },
    "computer.sleep": async (payload) => {
      await sleepComputerIfIdle(deps, payload.computerId);
    },
    "computer.control-expire": async (payload) => {
      if (await expireComputerControl(deps, payload.computerId, payload.leaseId)) {
        scheduleComputerSleep(deps.jobs, payload.computerId);
      }
    },
    "skill.teaching-expire": async (payload) => {
      await expireTaughtSkillTeaching(deps, payload.skillId);
    },
    "history.compact": async (payload) => {
      await compactHistory(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          jobs: deps.jobs,
          memoryProviders: deps.memoryProviders,
          deploymentModelKey: deps.deploymentModelKey,
          ...(deps.executor.resolveModel ? { resolveModel: deps.executor.resolveModel } : {}),
        },
        payload.threadId,
      );
    },
  };
}
