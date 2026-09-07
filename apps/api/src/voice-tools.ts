import { createHash } from "node:crypto";
import { call, ORPCError } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import {
  isSecretAskBlock,
  latestAnswerableAskMessageId,
  REALTIME_VOICE_TOOL_NAMES,
  speechFromBlocks,
  spokenDecision,
} from "@rakazo/core";
import { createRepos, IsolationError, type PrismaClient } from "@rakazo/db";
import type { createRouter } from "./router.js";

type Router = ReturnType<typeof createRouter>;
export type VoiceToolInput = {
  botId: string;
  callId: string;
  name: string;
  args: Record<string, unknown>;
};

/** Voice reuses the authenticated chat API and its durable messages/approval boundaries. */
export function createVoiceToolExecutor(router: Router, prisma: PrismaClient) {
  const repos = createRepos(prisma);
  return async (actor: Actor, input: VoiceToolInput, signal: AbortSignal) => {
    if (!REALTIME_VOICE_TOOL_NAMES.has(input.name)) throw new ORPCError("BAD_REQUEST");
    await repos.getBot(actor, input.botId);
    const options = { context: { actor, signal } };
    const args = input.args;
    const string = (key: string, max = 32000) => {
      const value = args[key];
      if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new ORPCError("BAD_REQUEST", { message: `A valid ${key} is required.` });
      return value.trim();
    };
    const nonce = `voice:${createHash("sha256")
      .update(JSON.stringify([actor.userId, input.botId, input.callId]))
      .digest("hex")}`;
    let agentId = args.agentId === undefined ? input.botId : string("agentId", 200);
    // Validate the explicit target even for actions whose default is the selected bot.
    await repos.getBot(actor, agentId);
    if (input.name === "list_agents") {
      return {
        agents: (await repos.listBots(actor)).map(({ id, name, title, status }) => ({
          id,
          name,
          title,
          status,
        })),
      };
    }
    if (input.name === "list_connections") {
      return {
        connections: (await call(router.connections.list, {}, options)).map(
          ({ connectorId, provider, status }) => ({ connectorId, provider, status }),
        ),
      };
    }
    if (input.name === "spawn_agent") {
      const name = string("name", 80);
      const request = string("request");
      const existing = () =>
        prisma.bot.findFirst({
          where: { spaceId: actor.spaceId, userId: actor.userId, spawnKey: nonce },
        });
      let bot: { id: string; archivedAt: unknown } | null = await existing();
      if (!bot) {
        try {
          bot = await repos.createBot(actor, {
            name,
            title: "",
            description: request,
            instructions: "",
            notifyOnFinish: true,
            parentBotId: input.botId,
            spawnKey: nonce,
            computerMode: "team",
          });
        } catch (error) {
          // A concurrent delivery may have committed the unique spawn key.
          bot = await existing();
          if (!bot) throw error;
        }
      }
      if (!bot || bot.archivedAt) throw new IsolationError();
      agentId = bot.id;
    }
    const snapshot = await call(router.threads.get, { botId: agentId }, options);
    const pendingId = latestAnswerableAskMessageId(snapshot);
    const pending = snapshot.messages.find((message) => message.id === pendingId);
    const protectedInput = pending?.blocks.some(isSecretAskBlock);
    if (input.name === "task_status") {
      const latest = [...snapshot.messages]
        .reverse()
        .find(
          (message) =>
            message.role === "bot" && (!snapshot.run || message.runId === snapshot.run.id),
        );
      return {
        agentId,
        status: snapshot.run?.status ?? "idle",
        runId: snapshot.run?.id ?? null,
        message: protectedInput
          ? "Protected input is required on screen. Do not say the secret aloud."
          : latest
            ? speechFromBlocks(
                latest.blocks.filter((block) => block.kind !== "progress" && block.kind !== "meta"),
              ).slice(0, 8000)
            : "No task result yet.",
      };
    }
    if (input.name === "stop_task") {
      await call(router.threads.stop, { botId: agentId }, options);
      return {
        agentId,
        status: "stopped",
        message: "Stop requested; completed actions are not undone.",
      };
    }
    if (input.name === "resume_agent") {
      if (protectedInput)
        return {
          agentId,
          status: "waiting_input",
          message: "Complete protected input on screen first.",
        };
      await call(router.computer.release, { botId: input.botId }, options);
      return {
        agentId: input.botId,
        status: "released",
        message: "The selected screen has been handed back. Check task_status for progress.",
      };
    }
    const request = string("request");
    if (protectedInput)
      return {
        agentId,
        status: "waiting_input",
        message: "Enter the secret in the protected on-screen input.",
      };
    if (pending?.runId) {
      await call(
        router.threads.answer,
        {
          botId: agentId,
          runId: pending.runId,
          messageId: pending.id,
          answer: spokenDecision(request) ?? request,
        },
        options,
      );
    } else {
      await call(
        router.threads.send,
        { botId: agentId, text: request, clientNonce: nonce },
        options,
      );
    }
    return {
      agentId,
      accepted: true,
      message:
        "Request accepted. Work runs independently of the call; acceptance is not completion. Use task_status for fresh progress.",
    };
  };
}
