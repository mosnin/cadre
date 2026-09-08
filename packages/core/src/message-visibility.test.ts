import type { ThreadMessage } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { isVisibleInternalPeerEvent, userVisibleMessages } from "./message-visibility.js";

function message(id: string, runId: string, blocks: ThreadMessage["blocks"]): ThreadMessage {
  return {
    id,
    threadId: "thread-1",
    seq: 1,
    role: "bot",
    blocks,
    runId,
    createdAt: "2026-08-30T22:00:00.000Z",
  };
}

const peerExchange = [
  message("user", "run-user", [{ kind: "text", text: "Please ask Coder." }]),
  message("sent", "run-user", [
    { kind: "bot_message_sent", toBotId: "coder", toBotName: "Coder", text: "Check this." },
  ]),
  message("received", "run-peer", [
    {
      kind: "bot_message_received",
      fromBotId: "coder",
      fromBotName: "Coder",
      text: "Done.",
    },
  ]),
  message("activity", "run-peer", [{ kind: "steps", steps: [{ label: "Message bot", count: 1 }] }]),
  message("reply", "run-peer", [{ kind: "text", text: "Sent Coder the endpoints." }]),
  message("answer", "run-user", [{ kind: "text", text: "Coder is checking it." }]),
];

describe("user-visible messages", () => {
  it("keeps bot-to-bot exchanges out of the user transcript", () => {
    expect(userVisibleMessages(peerExchange).map((item) => item.id)).toEqual(["user", "answer"]);
  });

  it("keeps compact peer receipts when includePeerReceipts is set", () => {
    expect(
      userVisibleMessages(peerExchange, { includePeerReceipts: true }).map((item) => item.id),
    ).toEqual(["user", "sent", "received", "answer"]);
  });

  it("uses authoritative peer run ids when the receipt is outside the loaded page", () => {
    const messages = [
      message("reply", "run-peer", [{ kind: "text", text: "Echoed peer reply" }]),
      message("answer", "run-user", [{ kind: "text", text: "Visible answer" }]),
    ];

    expect(
      userVisibleMessages(messages, { knownPeerRunIds: ["run-peer"] }).map((item) => item.id),
    ).toEqual(["answer"]);
  });
  it.each(["result", "status"] as const)(
    "keeps %s callback answers with their source receipt in the client page",
    (intent) => {
      const rows = [
        message("receipt", "callback", [
          {
            kind: "bot_message_received",
            fromBotId: "peer",
            fromBotName: "Peer",
            intent,
            text: "42",
          },
        ]),
        message("summary", "callback", [{ kind: "text", text: "The answer is 42." }]),
      ];
      expect(userVisibleMessages(rows).map((row) => row.id)).toEqual(["summary"]);
      expect(userVisibleMessages(rows, { includePeerReceipts: true }).map((row) => row.id)).toEqual(
        ["receipt", "summary"],
      );
    },
  );

  it.each([
    { kind: "ask", text: "Approve?", approvalEffectId: "approval-1", status: "pending" },
    { kind: "ask", text: "Secret?", input: "secret", status: "answered" },
    { kind: "choice", question: "Which?", options: [] },
    {
      kind: "app_connect",
      provider: "app",
      name: "App",
      description: "Connect",
      logo: null,
      status: "connected",
    },
    { kind: "computer", state: "Needs you", text: "Sign in" },
  ] as ThreadMessage["blocks"])(
    "preserves human input cards for an internal peer run: $kind",
    (block) => {
      const rows = [
        message("input", "internal", [block]),
        message("chatter", "internal", [{ kind: "text", text: "Internal chatter" }]),
      ];
      expect(
        userVisibleMessages(rows, { knownPeerRunIds: ["internal"] }).map((row) => row.id),
      ).toEqual(["input"]);
    },
  );
});

describe("internal peer live event visibility", () => {
  it("keeps the complete human intervention lifecycle while suppressing chatter", () => {
    const types = [
      "run.started",
      "thread.progress",
      "thread.ask",
      "run.waiting_input",
      "thread.message.updated",
      "run.started",
      "agent.tool.called",
      "computer.takeover.requested",
      "run.completed",
    ];
    expect(
      types.filter((type) =>
        isVisibleInternalPeerEvent({
          type,
          payload: { blocks: [{ kind: "ask", status: "answered", text: "Approved" }] },
        }),
      ),
    ).toEqual([
      "run.started",
      "thread.ask",
      "run.waiting_input",
      "thread.message.updated",
      "run.started",
      "computer.takeover.requested",
      "run.completed",
    ]);
    expect(
      isVisibleInternalPeerEvent({
        type: "thread.message.created",
        payload: { blocks: [{ kind: "text", text: "Internal reply" }] },
      }),
    ).toBe(false);
    expect(
      isVisibleInternalPeerEvent({
        type: "thread.message.created",
        payload: { blocks: [{ kind: "mcp_approval", name: "Server" }] },
      }),
    ).toBe(true);
  });
});
