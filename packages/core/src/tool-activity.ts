import type { MessageBlock } from "@cadre/contracts";

export function isToolActivityBlock(block: MessageBlock): boolean {
  return block.kind === "steps" || (block.kind === "progress" && block.activity === true);
}
