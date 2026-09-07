import type { ThreadSnapshot } from "@rakazo/contracts";
import { isSecretAskBlock } from "@rakazo/core";

export function pendingSecretAsk(snapshot: ThreadSnapshot | null) {
  const askId = latestAskId(snapshot);
  const askMessage = snapshot?.messages.find((message) => message.id === askId);
  return askMessage?.blocks.some(
    (block) => block.kind === "ask" && isSecretAskBlock(block) && block.status !== "answered",
  );
}

export function latestAskId(snapshot: ThreadSnapshot | null): string | null {
  if (snapshot?.run?.status !== "waiting_input") return null;
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message?.runId !== snapshot.run.id) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      return message.id;
    }
  }
  return null;
}

export function hasWorkingRun(snapshot: ThreadSnapshot | null) {
  return [snapshot?.run, ...(snapshot?.activeRuns ?? [])].some(
    (run) => run && ["running", "queued", "leased"].includes(run.status),
  );
}
