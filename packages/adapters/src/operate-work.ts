import type { JobPublisher } from "@cadre/adapter-kit";
import { runContinueJob, runJobKey } from "@cadre/adapter-kit";
import type { Actor } from "@cadre/contracts";
import { type Pool, type PrismaClient, requireMembership, type ThreadEvents } from "@cadre/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as z from "zod";
import type { WorkspaceIntegrations } from "./workspace-integrations.js";

/**
 * Operate work: a member's Operate agent gets its tasks done by one of their
 * bots. Every tick the loop reports finished runs back to Operate, then, when
 * the bot is free, asks Operate for the next task, loads and acknowledges its
 * context, claims it, opens an Operate run, and starts a Cadre run with the
 * task as the prompt.
 *
 * The loop owns the Operate protocol (claim, run, complete, release) so a
 * model never has to get it right; the bot only does the work and ends with a
 * summary, which becomes the completion note humans read in Operate.
 */

const TICK_MS = 30_000;
const CLAIM_REFRESH_MS = 20 * 60_000;
const CONTEXT_TOKEN_BUDGET = 4_000;
const CONTEXT_CHAR_CAP = 16_000;
const SUMMARY_CHAR_CAP = 4_000;
const terminal = new Set(["completed", "failed", "cancelled"]);

export interface OperatePeer {
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

/** Operate wraps every tool result as `{ result }` in structured content, or JSON text. */
function toolResult(result: Record<string, unknown>): unknown {
  const text = (Array.isArray(result.content) ? result.content : [])
    .flatMap((c) =>
      c && typeof c === "object" && "text" in c && typeof c.text === "string" ? [c.text] : [],
    )
    .join("\n");
  // Provider error text can quote request data; surface only that it failed.
  if (result.isError) throw new Error("Operate refused the request");
  const structured = result.structuredContent;
  if (structured && typeof structured === "object" && "result" in structured)
    return structured.result;
  return text ? JSON.parse(text) : null;
}

export async function connectOperate(endpoint: string, token: string): Promise<OperatePeer> {
  const client = new Client({ name: "cadre-operate-work", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
  });
  try {
    await client.connect(transport, { timeout: 15_000 });
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
  return {
    async call(name, args = {}) {
      return toolResult(
        await client.callTool({ name, arguments: args }, undefined, { timeout: 20_000 }),
      );
    },
    close: () => client.close(),
  };
}

const NextTask = z.object({
  tasks: z.array(
    z
      .object({ taskId: z.string(), title: z.string(), description: z.string().nullish() })
      .passthrough(),
  ),
});
const TaskContext = z
  .object({
    acknowledge: z.array(z.object({ packetId: z.string(), version: z.number() })).optional(),
  })
  .passthrough();

export type OperateTask = { taskId: string; title: string; description?: string | null };

/**
 * The prompt a bot receives for an Operate task. It names the connectors to
 * read first when the member has them (Company OS for the company's rules and
 * this agent's charter, stored for what was learned before), and says plainly
 * that Cadre reports the outcome, so the bot does not complete the task itself.
 */
export function operateTaskPrompt(input: { botName: string; task: OperateTask; context: unknown }) {
  const context = JSON.stringify(input.context ?? {}, null, 1);
  const clipped =
    context.length > CONTEXT_CHAR_CAP
      ? `${context.slice(0, CONTEXT_CHAR_CAP)}\n… (context trimmed)`
      : context;
  return [
    `Operate task: ${input.task.title}`,
    `Task id: ${input.task.taskId}`,
    input.task.description?.trim() ? `\n${input.task.description.trim()}` : "",
    `\nContext from Operate:\n${clipped}`,
    [
      "\nBefore you start:",
      `- If Company OS is connected, call agent_brief with agent "${input.botName}" and follow its autonomy policy.`,
      "- If Stored is connected, call get_context_pack for this task to recall what was learned before.",
      "\nWhile you work, you may comment or attach evidence on the task in Operate. Do not claim, complete, or release it, and do not start or finish Operate runs: Cadre reports your result when you finish.",
      "\nEnd with a short summary of what you did and links to anything you produced. It becomes the completion note in Operate. Save anything that would make the next run better to memory.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

export interface OperateWorkDeps {
  prisma: PrismaClient;
  pool?: Pool;
  events: ThreadEvents;
  jobs: JobPublisher;
  /** The member's Operate MCP endpoint and a fresh token, or null when not connected. */
  credential: (actor: Actor) => Promise<{ endpoint: string; token: string } | null>;
  connect?: typeof connectOperate;
}

/** The member's Operate grant, as the endpoint and token the loop calls with. */
export function operateCredentialFrom(
  integrations: WorkspaceIntegrations,
): OperateWorkDeps["credential"] {
  return async (actor) => {
    const credential = await integrations.credential("operate", actor);
    if (!credential) return null;
    const config = integrations.provider("operate");
    return {
      endpoint: `${config.origin}${config.mcp(credential.identity)}`,
      token: credential.token,
    };
  };
}

export function createOperateWork(deps: OperateWorkDeps) {
  const { prisma, pool, events, jobs } = deps;
  const connect = deps.connect ?? connectOperate;

  async function locked<T>(key: string, action: () => Promise<T>): Promise<T | null> {
    if (!pool) throw new Error("Operate work requires a PostgreSQL connection pool");
    const lock = await pool.connect();
    try {
      const result = await lock.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [`cadre-operate:${key}`],
      );
      if (!result.rows[0].locked) return null;
      try {
        return await action();
      } finally {
        await lock.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
          `cadre-operate:${key}`,
        ]);
      }
    } finally {
      lock.release();
    }
  }

  async function lastBotText(runId: string) {
    const message = await prisma.message.findFirst({
      where: { runId, role: "bot" },
      orderBy: { seq: "desc" },
    });
    const blocks = Array.isArray(message?.blocks) ? message.blocks : [];
    return blocks
      .flatMap((b) =>
        b &&
        typeof b === "object" &&
        "kind" in b &&
        b.kind === "text" &&
        "text" in b &&
        typeof b.text === "string"
          ? [b.text]
          : [],
      )
      .join("\n")
      .slice(0, SUMMARY_CHAR_CAP)
      .trim();
  }

  /** Give a task back to Operate: close the Operate run (if any) and drop the claim. */
  async function giveBack(
    peer: OperatePeer,
    assignment: { taskId: string; operateRunId: string | null },
    status: "failed" | "abandoned",
    error: string,
  ) {
    if (assignment.operateRunId)
      await peer
        .call("finish_run", { runId: assignment.operateRunId, status, error })
        .catch(() => {});
    await peer.call("release_task", { taskId: assignment.taskId }).catch(() => {});
  }

  async function report(peer: OperatePeer, workerId: string, spaceId: string) {
    const open = await prisma.operateAssignment.findMany({
      where: { workerId, reported: false },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    let busy = false;
    for (const assignment of open) {
      const run = assignment.runId
        ? await prisma.run.findFirst({ where: { id: assignment.runId, spaceId } })
        : null;
      if (!run) {
        await giveBack(
          peer,
          assignment,
          "abandoned",
          "The Cadre run for this task is no longer available.",
        );
      } else if (!terminal.has(run.status)) {
        busy = true;
        // Claims expire after an hour in Operate; renew well before that.
        if (Date.now() - assignment.claimedAt.getTime() > CLAIM_REFRESH_MS) {
          // A failed renewal is left for Operate's watchdog: the claim lapses and
          // the task is released there, and this run's completion is refused.
          await peer.call("claim_task", { taskId: assignment.taskId }).catch(() => {});
          await peer
            .call("heartbeat", {
              statusText: `Working on ${assignment.title}`.slice(0, 200),
              currentTaskId: assignment.taskId,
            })
            .catch(() => {});
          await prisma.operateAssignment.update({
            where: { id: assignment.id },
            data: { claimedAt: new Date() },
          });
        }
        continue;
      } else {
        const summary = run.status === "completed" ? await lastBotText(run.id) : "";
        if (run.status === "completed" && summary) {
          if (assignment.operateRunId)
            await peer.call("finish_run", {
              runId: assignment.operateRunId,
              status: "succeeded",
              summary,
            });
          await peer.call("complete_task", { taskId: assignment.taskId, note: summary });
        } else {
          await giveBack(
            peer,
            assignment,
            run.status === "cancelled" ? "abandoned" : "failed",
            run.status === "completed"
              ? "The run ended without a summary of what was done."
              : `The Cadre run ${run.status === "cancelled" ? "was cancelled" : "failed"}.`,
          );
        }
      }
      await prisma.operateAssignment.update({
        where: { id: assignment.id },
        data: { reported: true },
      });
    }
    return busy;
  }

  async function pull(
    peer: OperatePeer,
    worker: { id: string; spaceId: string; userId: string },
    bot: { id: string; name: string; thread: { id: string } },
  ) {
    const next = NextTask.parse(await peer.call("next_task", { limit: 1 }));
    const task = next.tasks[0];
    if (!task) return;
    const context = TaskContext.parse(
      await peer.call("get_task_context", {
        taskId: task.taskId,
        tokenBudget: CONTEXT_TOKEN_BUDGET,
      }),
    );
    // The loop hands the whole returned context to the bot, so acknowledging
    // exactly the packets returned is truthful.
    if (context.acknowledge?.length)
      await peer.call("acknowledge_task_context", {
        taskId: task.taskId,
        packets: context.acknowledge,
      });
    await peer.call("claim_task", { taskId: task.taskId });
    // Recorded before anything else can fail, so a crash still gets reported.
    const assignment = await prisma.operateAssignment.create({
      data: { workerId: worker.id, taskId: task.taskId, title: task.title.slice(0, 500) },
    });
    try {
      const operateRunId = z
        .string()
        .parse(await peer.call("start_run", { title: task.title, taskId: task.taskId }));
      await prisma.operateAssignment.update({
        where: { id: assignment.id },
        data: { operateRunId },
      });
      const prompt = operateTaskPrompt({ botName: bot.name, task, context });
      const sent = await events.sendUserMessage({
        spaceId: worker.spaceId,
        userId: worker.userId,
        botId: bot.id,
        threadId: bot.thread.id,
        trigger: "webhook",
        prompt,
        blocks: [{ kind: "text", text: prompt }],
        clientNonce: `operate:${assignment.id}`,
      });
      if (!sent.runId) throw new Error("The task did not create a durable run");
      await prisma.operateAssignment.update({
        where: { id: assignment.id },
        data: { runId: sent.runId },
      });
      await jobs.enqueue(runContinueJob(sent.runId));
    } catch (error) {
      const current = await prisma.operateAssignment.findUniqueOrThrow({
        where: { id: assignment.id },
      });
      await giveBack(peer, current, "abandoned", "Cadre could not start a run for this task.");
      await prisma.operateAssignment.update({
        where: { id: assignment.id },
        data: { reported: true },
      });
      throw error;
    }
  }

  async function tickWorker(id: string) {
    await locked(id, async () => {
      const worker = await prisma.operateWorker.findUnique({ where: { id } });
      if (!worker) return;
      let peer: OperatePeer | undefined;
      try {
        const actor = await requireMembership(prisma, worker.userId, worker.spaceId);
        const credential = await deps.credential(actor);
        if (!credential) {
          await prisma.operateWorker.update({
            where: { id },
            data: { lastError: "Reconnect Operate in Settings." },
          });
          return;
        }
        peer = await connect(credential.endpoint, credential.token);
        const busy = await report(peer, worker.id, worker.spaceId);
        const bot = await prisma.bot.findFirst({
          where: { id: worker.botId, spaceId: worker.spaceId, archivedAt: null },
          include: { thread: true },
        });
        const botRunning = bot
          ? await prisma.run.count({ where: { botId: bot.id, status: { notIn: [...terminal] } } })
          : 0;
        if (worker.enabled && !busy && bot?.thread && botRunning === 0)
          await pull(peer, worker, { id: bot.id, name: bot.name, thread: bot.thread });
        await prisma.operateWorker.update({
          where: { id },
          data: { lastSyncedAt: new Date(), lastError: null },
        });
      } catch {
        await prisma.operateWorker.update({
          where: { id },
          data: { lastError: "Sync failed. Check the Operate connection and this agent's access." },
        });
      } finally {
        await peer?.close().catch(() => {});
      }
    });
  }

  /** Point a member's Operate tasks at a bot, or stop (botId null) once nothing is in flight. */
  async function configure(actor: Actor, input: { botId: string | null; enabled?: boolean }) {
    const existing = await prisma.operateWorker.findUnique({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    });
    const inFlight = existing
      ? await prisma.operateAssignment.count({ where: { workerId: existing.id, reported: false } })
      : 0;
    if (existing && inFlight && input.botId !== existing.botId)
      throw new Error("Finish or cancel the task in progress before changing the bot");
    if (!input.botId) {
      if (existing) await prisma.operateWorker.delete({ where: { id: existing.id } });
      return null;
    }
    const bot = await prisma.bot.findFirst({
      where: { id: input.botId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
    });
    if (!bot) throw new Error("Bot not found");
    const enabled = input.enabled ?? true;
    const row = existing
      ? await prisma.operateWorker.update({
          where: { id: existing.id },
          data: { botId: bot.id, enabled, lastError: null },
        })
      : await prisma.operateWorker.create({
          data: { spaceId: actor.spaceId, userId: actor.userId, botId: bot.id, enabled },
        });
    return status(actor, row.id);
  }

  async function status(actor: Actor, id?: string) {
    const row = id
      ? await prisma.operateWorker.findFirst({
          where: { id, spaceId: actor.spaceId, userId: actor.userId },
        })
      : await prisma.operateWorker.findUnique({
          where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
        });
    if (!row) return null;
    const assignments = await prisma.operateAssignment.findMany({
      where: { workerId: row.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { run: { select: { status: true } } },
    });
    return {
      botId: row.botId,
      enabled: row.enabled,
      lastSyncedAt: row.lastSyncedAt,
      lastError: row.lastError,
      assignments: assignments.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        title: a.title,
        runId: a.runId,
        reported: a.reported,
        status: a.run?.status ?? (a.reported ? "reported" : "queued"),
      })),
    };
  }

  /** Cancelling the Cadre run is how a member stops a task; the next tick releases it in Operate. */
  async function cancel(actor: Actor, assignmentId: string) {
    const assignment = await prisma.operateAssignment.findFirst({
      where: {
        id: assignmentId,
        reported: false,
        worker: { spaceId: actor.spaceId, userId: actor.userId },
      },
    });
    if (!assignment?.runId) return;
    await prisma.run.updateMany({
      where: { id: assignment.runId, spaceId: actor.spaceId, status: { notIn: [...terminal] } },
      data: { status: "cancelled", completedAt: new Date() },
    });
    await jobs.cancel(runJobKey(assignment.runId));
  }

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> | undefined;
  async function tick() {
    for (const row of await prisma.operateWorker.findMany({ select: { id: true } })) {
      if (stopping) break;
      await tickWorker(row.id);
    }
  }
  function start() {
    const next = () => {
      pending = tick()
        .catch(() => {})
        .finally(() => {
          if (!stopping) timer = setTimeout(next, TICK_MS);
        });
    };
    next();
  }
  async function stop() {
    stopping = true;
    if (timer) clearTimeout(timer);
    await pending;
  }

  return { configure, status, cancel, tickWorker, start, stop };
}
