import type { MessageBlock } from "@rakazo/contracts";

type PresentableMessage = {
  runId?: string;
  blocks: readonly MessageBlock[];
};

export type UserVisibleMessagesOptions = {
  /**
   * Keep `bot_message_sent` / `bot_message_received` rows as compact chips
   * (web CollaborationMarker; mobile AgentEventLabel). Peer bodies stay hidden.
   */
  includePeerReceipts?: boolean;
  /** Internal request/question/FYI run ids when receipts may be out of window. */
  knownPeerRunIds?: Iterable<string>;
};

export const PEER_CALLBACK_INTENTS = ["result", "status"] as const;

/** Result/status callbacks resume the coordinator's user-facing conversation. */
export function isUserFacingPeerCallback(blocks: unknown): boolean {
  return (
    Array.isArray(blocks) &&
    blocks.some(
      (block) =>
        block &&
        typeof block === "object" &&
        block.kind === "bot_message_received" &&
        PEER_CALLBACK_INTENTS.some((intent) => intent === block.intent),
    )
  );
}

/** Requests for human input must remain reachable even during internal delegation. */
export function hasUserInputBlocks(blocks: unknown): boolean {
  return (
    Array.isArray(blocks) &&
    blocks.some(
      (block) =>
        block &&
        typeof block === "object" &&
        (["ask", "choice", "app_connect", "connect", "mcp_approval"].includes(block.kind) ||
          (block.kind === "computer" && block.state === "Needs you")),
    )
  );
}

export function isPeerReceiptBlocks(blocks: readonly MessageBlock[]): boolean {
  return blocks.some(
    (block) => block?.kind === "bot_message_sent" || block?.kind === "bot_message_received",
  );
}

/** Hide internal peer chatter, preserving callbacks and human input cards. */
export function userVisibleMessages<T extends PresentableMessage>(
  messages: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T[] {
  const peerRunIds = new Set([
    ...(options.knownPeerRunIds ?? []),
    ...messages
      .filter(
        (message) =>
          !isUserFacingPeerCallback(message.blocks) &&
          message.blocks.some((block) => block.kind === "bot_message_received"),
      )
      .flatMap((message) => (message.runId ? [message.runId] : [])),
  ]);
  const includePeerReceipts = options.includePeerReceipts === true;

  return messages.filter((message) => {
    if (hasUserInputBlocks(message.blocks)) return true;
    if (isPeerReceiptBlocks(message.blocks)) return includePeerReceipts;
    return !message.runId || !peerRunIds.has(message.runId);
  });
}

/** Internal delegation still exposes task lifecycle and anything requiring the human. */
export function isVisibleInternalPeerEvent(event: {
  type: string;
  payload: Record<string, unknown>;
}): boolean {
  if (event.type.startsWith("run.") || event.type.startsWith("computer.")) return true;
  if (["thread.ask", "thread.choice", "thread.computer"].includes(event.type)) return true;
  if (!["thread.message.created", "thread.message.updated"].includes(event.type)) return false;
  return (
    hasUserInputBlocks(event.payload.blocks) ||
    (Array.isArray(event.payload.blocks) && isPeerReceiptBlocks(event.payload.blocks))
  );
}
