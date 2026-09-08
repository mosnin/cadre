import { randomUUID } from "node:crypto";
import type { MessageBlock } from "@rakazo/contracts";
import { isVisibleInternalPeerEvent, userVisibleMessages } from "@rakazo/core";
import { createDb, type Prisma } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { isInternalPeerRun, loadMessagePage } from "./thread-message-pages.js";
import { type ThreadTarget, threadSnapshot } from "./thread-target.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("peer callback and human input visibility (PostgreSQL)", () => {
  it("keeps callbacks visible, internal chatter hidden, and human intervention reachable across lifecycle changes", async () => {
    const { prisma, pool } = createDb(databaseUrl!);
    const id = randomUUID();
    let seq = 0;
    try {
      await prisma.user.create({
        data: { id, name: "Visibility test", email: `${id}@example.test` },
      });
      await prisma.organization.create({
        data: { id, name: "Visibility test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Test", createdByUserId: id },
      });
      await prisma.bot.create({
        data: { id, spaceId: id, userId: id, name: "Test", color: "#000" },
      });
      await prisma.thread.create({ data: { id, spaceId: id, userId: id, botId: id } });
      const task = await prisma.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: id,
          threadId: id,
          prompt: "Test",
          status: "running",
        },
      });
      const target = {
        kind: "bot",
        botId: id,
        threadId: id,
        bot: { computer: null },
      } as ThreadTarget;
      for (const intent of [
        "result",
        "status",
        "request",
        "question",
        "fyi",
        undefined,
        null,
      ] as const) {
        const source =
          intent === null
            ? null
            : await prisma.message.create({
                data: {
                  threadId: id,
                  seq: ++seq,
                  role: "user",
                  blocks: [
                    {
                      kind: "bot_message_received",
                      ...(intent ? { intent } : {}),
                      text: "42",
                      fromBotId: "peer",
                      fromBotName: "Peer",
                    },
                  ],
                },
              });
        const run = await prisma.run.create({
          data: {
            spaceId: id,
            userId: id,
            botId: id,
            threadId: id,
            taskId: task.id,
            trigger: "bot_message",
            status: "completed",
            sourceMessageId: source?.id,
          },
        });
        if (source)
          await prisma.message.update({ where: { id: source.id }, data: { runId: run.id } });
        const summary = await prisma.message.create({
          data: {
            threadId: id,
            seq: ++seq,
            role: "bot",
            botId: id,
            runId: run.id,
            blocks: [{ kind: "text", text: `${intent ?? "missing"}: 23 + 19 = 42` }],
          },
        });
        const visible = intent === "result" || intent === "status";
        const cache = new Map<string, Promise<boolean>>();
        expect(await isInternalPeerRun(prisma, run.id, cache)).toBe(!visible);
        for (const around of [undefined, { seq: summary.seq }]) {
          // A one-row window forces sourceMessage to be resolved outside the loaded page.
          const page = await loadMessagePage(prisma, id, undefined, 1, around);
          expect(page.messages.some((message) => message.id === summary.id)).toBe(visible);
        }
        const fullPage = await loadMessagePage(prisma, id, undefined, 100);
        expect(
          userVisibleMessages(fullPage.messages, { includePeerReceipts: true }).some(
            (message) => message.id === summary.id,
          ),
        ).toBe(visible);
        if (!visible) {
          await prisma.event.create({
            data: {
              spaceId: id,
              botId: id,
              threadId: id,
              runId: run.id,
              seq: ++seq,
              type: "agent.tool.called",
              payload: { name: "INTERNAL_TOOL" },
            },
          });
          const ask = await prisma.message.create({
            data: {
              threadId: id,
              seq: ++seq,
              role: "bot",
              botId: id,
              runId: run.id,
              blocks: [
                {
                  kind: "ask",
                  text: "Approve this step?",
                  approvalEffectId: "test-approval",
                  status: "pending",
                },
              ],
            },
          });
          for (const status of [
            "waiting_input",
            "queued",
            "running",
            "waiting_takeover",
            "failed",
            "completed",
          ]) {
            await prisma.run.update({ where: { id: run.id }, data: { status } });
            const snapshot = await threadSnapshot({ prisma }, target);
            expect(snapshot.run?.status ?? null).toBe(status === "completed" ? null : status);
            expect(snapshot.messages.some((message) => message.id === ask.id)).toBe(true);
            expect(snapshot.messages.some((message) => message.id === summary.id)).toBe(false);
            expect(snapshot.messages.some((message) => message.id === `progress:${run.id}`)).toBe(
              false,
            );
          }
          const answered: MessageBlock[] = [
            { kind: "ask", text: "Approve this step?", status: "answered", answer: "Yes" },
          ];
          await prisma.message.update({
            where: { id: ask.id },
            data: { blocks: answered as Prisma.InputJsonValue },
          });
          expect(
            isVisibleInternalPeerEvent({
              type: "thread.message.updated",
              payload: { blocks: answered },
            }),
          ).toBe(true);
          const page = await loadMessagePage(prisma, id, undefined, 100);
          expect(userVisibleMessages(page.messages).some((message) => message.id === ask.id)).toBe(
            true,
          );
        }
      }
    } finally {
      await prisma.organization.deleteMany({ where: { id } });
      await prisma.user.deleteMany({ where: { id } });
      await prisma.$disconnect();
      await pool.end();
    }
  });
});
