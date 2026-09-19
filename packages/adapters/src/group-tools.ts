import { type Actor, GROUP_MEMBER_MAX, GROUP_MEMBER_MIN } from "@cadre/contracts";
import { resolveBotAddress } from "@cadre/core";
import { createGroupRepos, IsolationError, type PrismaClient } from "@cadre/db";

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    items.push(text);
  }
  return items;
}

export async function createGroupFromTool(
  deps: { prisma: PrismaClient },
  input: {
    spaceId: string;
    userId: string;
    callerBotId: string;
    name: string;
    botIds?: unknown;
    names?: unknown;
  },
): Promise<
  | {
      ok: true;
      groupId: string;
      threadId: string;
      name: string;
      members: Array<{ botId: string; name: string }>;
    }
  | { error: string }
> {
  const name = input.name.trim();
  if (!name) return { error: "Group name is required." };
  if (name.length > 80) return { error: "Group name must be 80 characters or fewer." };

  const requestedIds = uniqueStrings(input.botIds);
  const requestedNames = uniqueStrings(input.names);
  if (requestedIds.length + requestedNames.length === 0) {
    return { error: "Name 2 to 6 bots to include, using bot_ids or names." };
  }

  const candidates = await deps.prisma.bot.findMany({
    where: {
      spaceId: input.spaceId,
      userId: input.userId,
      archivedAt: null,
    },
    select: { id: true, name: true },
  });

  const members: Array<{ botId: string; name: string }> = [];
  const seen = new Set<string>();
  const add = (bot: { id: string; name: string }) => {
    if (seen.has(bot.id)) return;
    seen.add(bot.id);
    members.push({ botId: bot.id, name: bot.name });
  };

  for (const botId of requestedIds) {
    const bot = resolveBotAddress(candidates, { botId });
    if (!bot) return { error: `No bot found with id ${botId}` };
    add(bot);
  }
  for (const botName of requestedNames) {
    const bot = resolveBotAddress(candidates, { name: botName });
    if (!bot) return { error: `No bot found named ${botName}` };
    add(bot);
  }

  if (members.length === 1 && !seen.has(input.callerBotId)) {
    const self = candidates.find((bot) => bot.id === input.callerBotId);
    if (self) add(self);
  }

  if (members.length < GROUP_MEMBER_MIN || members.length > GROUP_MEMBER_MAX) {
    return {
      error: `Groups require ${GROUP_MEMBER_MIN} to ${GROUP_MEMBER_MAX} distinct bots`,
    };
  }

  const actor: Actor = {
    userId: input.userId,
    spaceId: input.spaceId,
    email: "",
    isDeploymentOwner: false,
  };
  try {
    const group = await createGroupRepos(deps.prisma).createGroup(actor, {
      name,
      botIds: members.map((member) => member.botId),
    });
    return {
      ok: true,
      groupId: group.id,
      threadId: group.threadId,
      name: group.name,
      members: group.members.map((member) => ({ botId: member.botId, name: member.name })),
    };
  } catch (error) {
    if (error instanceof IsolationError) {
      return {
        error:
          error.message === "Resource not found"
            ? "Those bots are not available in this workspace."
            : error.message,
      };
    }
    throw error;
  }
}
