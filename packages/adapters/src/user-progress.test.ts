import type { MessageBlock } from "@rakazo/contracts";
import { isToolActivityBlock } from "@rakazo/core";
import { describe, expect, it } from "vitest";
import {
  alreadyPublishedProgress,
  botMessageOutcomeFromMidTurn,
  clampUserProgressMessage,
  extractNarrationText,
  finalBlocksAfterMidTurnProgress,
  isUserProgressClientNonce,
  USER_PROGRESS_MESSAGE_MAX_LENGTH,
  userProgressClientNonce,
} from "./user-progress.js";

describe("clampUserProgressMessage", () => {
  it("trims and rejects empty text", () => {
    expect(clampUserProgressMessage("  hello  ")).toBe("hello");
    expect(clampUserProgressMessage("   ")).toBe("");
  });

  it("clamps long progress beats", () => {
    const clamped = clampUserProgressMessage("x".repeat(USER_PROGRESS_MESSAGE_MAX_LENGTH + 40));
    expect(clamped).toHaveLength(USER_PROGRESS_MESSAGE_MAX_LENGTH);
    expect(clamped.endsWith("…")).toBe(true);
  });
});

describe("extractNarrationText", () => {
  it("pulls text blocks and current text while keeping tool activity", () => {
    const { text, remaining } = extractNarrationText(
      [
        { kind: "text", text: "Checking calendars. " },
        { kind: "steps", steps: [{ label: "Web search", count: 1 }] },
        { kind: "text", text: "Found three options." },
      ],
      " Still looking.",
    );
    expect(text).toBe("Checking calendars. Found three options. Still looking.");
    expect(remaining).toEqual([{ kind: "steps", steps: [{ label: "Web search", count: 1 }] }]);
  });
});

describe("finalBlocksAfterMidTurnProgress", () => {
  it("does not repeat an answer already delivered through message_user", () => {
    const blocks: MessageBlock[] = [
      { kind: "steps", steps: [{ label: "Message user", count: 1 }] },
      { kind: "text", text: "The report is ready." },
    ];
    expect(finalBlocksAfterMidTurnProgress(blocks, true, ["The report is ready."])).toEqual([]);
    expect(finalBlocksAfterMidTurnProgress(blocks, true, ["Preparing the report."])).toEqual(
      blocks,
    );
  });

  it("preserves nontext content when removing repeated final text", () => {
    const blocks: MessageBlock[] = [
      { kind: "text", text: "Done." },
      { kind: "meta", text: "A separate receipt" },
    ];
    expect(finalBlocksAfterMidTurnProgress(blocks, true, ["Done."])).toEqual([blocks[1]]);
  });

  it("drops a hollow final message that is only hidden tool activity", () => {
    const steps: MessageBlock = { kind: "steps", steps: [{ label: "Shell", count: 2 }] };
    expect(finalBlocksAfterMidTurnProgress([steps], true)).toEqual([]);
    expect(finalBlocksAfterMidTurnProgress([steps], false)).toEqual([steps]);
  });

  it("keeps a final answer alongside tool activity", () => {
    const blocks: MessageBlock[] = [
      { kind: "steps", steps: [{ label: "Web search", count: 1 }] },
      { kind: "text", text: "You are free Tuesday afternoon." },
    ];
    expect(finalBlocksAfterMidTurnProgress(blocks, true)).toEqual(blocks);
    expect(isToolActivityBlock(blocks[0]!)).toBe(true);
  });
});

describe("alreadyPublishedProgress", () => {
  it("recognizes repeats across tool calls and restored progress without hiding new updates", () => {
    expect(alreadyPublishedProgress(" Checking tasks. ", ["Checking tasks."])).toBe(true);
    expect(alreadyPublishedProgress("Checking tasks. Two are blocked.", ["Checking tasks."])).toBe(
      false,
    );
    expect(alreadyPublishedProgress("", [""])).toBe(false);
    expect(alreadyPublishedProgress("Same words in a new run.", [])).toBe(false);
  });
});

describe("botMessageOutcomeFromMidTurn", () => {
  it("prefers the final reply as a result", () => {
    expect(botMessageOutcomeFromMidTurn("All set.", ["Checking calendars…"])).toEqual({
      text: "All set.",
      intent: "result",
    });
  });

  it("returns mid-turn progress as status when there is no final reply", () => {
    expect(
      botMessageOutcomeFromMidTurn("", ["Checking calendars…", "Found three free slots."]),
    ).toEqual({
      text: "Checking calendars…\n\nFound three free slots.",
      intent: "status",
    });
  });

  it("returns null when nothing was posted", () => {
    expect(botMessageOutcomeFromMidTurn("  ", [])).toBeNull();
  });
});

describe("userProgressClientNonce", () => {
  it("tags mid-turn progress messages for reconciler detection", () => {
    const nonce = userProgressClientNonce("run-1", 0);
    expect(nonce.startsWith("user-progress:run-1:0:")).toBe(true);
    expect(isUserProgressClientNonce(nonce)).toBe(true);
    expect(userProgressClientNonce("run-1", 0)).not.toBe(nonce);
    expect(isUserProgressClientNonce(null)).toBe(false);
    expect(isUserProgressClientNonce("other")).toBe(false);
  });
});
