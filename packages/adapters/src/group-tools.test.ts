import type { PrismaClient } from "@cadre/db";
import { describe, expect, it, vi } from "vitest";
import { createGroupFromTool } from "./group-tools.js";

const bots = [
  { id: "bot-chief", name: "Chief" },
  { id: "bot-writer", name: "Writer" },
  { id: "bot-researcher", name: "Researcher" },
];

function prismaForCreate() {
  const created = {
    id: "group-1",
    spaceId: "workspace-1",
    userId: "user-1",
    name: "Launch",
    pinned: false,
    sectionId: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    thread: { id: "thread-group-1", unread: false, messages: [] },
    members: bots.slice(0, 2).map((bot) => ({
      bot: { ...bot, color: "ink", runs: [] },
    })),
  };
  const tx = {
    chatGroup: {
      create: vi.fn(async () => ({ id: created.id })),
      findFirstOrThrow: vi.fn(async () => created),
    },
    chatGroupMember: { createMany: vi.fn(async () => ({ count: 2 })) },
    thread: { create: vi.fn(async () => ({ id: created.thread.id })) },
  };
  return {
    prisma: {
      bot: {
        findMany: vi.fn(async (args?: { where?: { id?: { in?: string[] } } }) => {
          const ids = args?.where?.id?.in;
          return ids ? bots.filter((bot) => ids.includes(bot.id)) : bots;
        }),
      },
      $transaction: vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient,
    tx,
  };
}

describe("createGroupFromTool", () => {
  it("creates a group from exact names and includes the caller when only one peer is named", async () => {
    const { prisma, tx } = prismaForCreate();
    await expect(
      createGroupFromTool(
        { prisma },
        {
          spaceId: "workspace-1",
          userId: "user-1",
          callerBotId: "bot-chief",
          name: "Launch",
          names: ["Writer"],
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      groupId: "group-1",
      threadId: "thread-group-1",
      name: "Launch",
    });
    expect(tx.chatGroupMember.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: "group-1", botId: "bot-writer" },
        { groupId: "group-1", botId: "bot-chief" },
      ],
    });
  });

  it("resolves mixed ids and names without duplicating the caller", async () => {
    const { prisma, tx } = prismaForCreate();
    await createGroupFromTool(
      { prisma },
      {
        spaceId: "workspace-1",
        userId: "user-1",
        callerBotId: "bot-chief",
        name: "Launch",
        botIds: ["bot-chief"],
        names: ["Writer", "writer"],
      },
    );
    expect(tx.chatGroupMember.createMany).toHaveBeenCalledWith({
      data: [
        { groupId: "group-1", botId: "bot-chief" },
        { groupId: "group-1", botId: "bot-writer" },
      ],
    });
  });

  it("refuses an unknown name without creating a group", async () => {
    const { prisma, tx } = prismaForCreate();
    await expect(
      createGroupFromTool(
        { prisma },
        {
          spaceId: "workspace-1",
          userId: "user-1",
          callerBotId: "bot-chief",
          name: "Launch",
          names: ["Missing"],
        },
      ),
    ).resolves.toEqual({ error: "No bot found named Missing" });
    expect(tx.chatGroup.create).not.toHaveBeenCalled();
  });

  it("refuses a one-member group when the caller is already the only named bot", async () => {
    const { prisma, tx } = prismaForCreate();
    await expect(
      createGroupFromTool(
        { prisma },
        {
          spaceId: "workspace-1",
          userId: "user-1",
          callerBotId: "bot-chief",
          name: "Solo",
          names: ["Chief"],
        },
      ),
    ).resolves.toEqual({ error: "Groups require 2 to 6 distinct bots" });
    expect(tx.chatGroup.create).not.toHaveBeenCalled();
  });
});
