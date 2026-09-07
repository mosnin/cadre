/** Reserved identity, independent of editable labels and untrusted model output. */
export const CHIPPI_BOT_PREFIX = "chippi_";
export function isChippiBot(bot: { id: string }): boolean {
  return /^chippi_[a-f0-9]{64}$/.test(bot.id);
}
export function assertBotLifecycleAllowed(bot: { id: string }): void {
  if (isChippiBot(bot))
    throw new Error("Chippi is the permanent orchestrator and cannot be archived or deleted.");
}
export function assertBotProfileAllowed(
  bot: { id: string },
  change: { name?: string; pinned?: boolean; sectionId?: string | null },
): void {
  if (!isChippiBot(bot)) return;
  if (
    (change.name !== undefined && change.name !== "Chippi") ||
    change.pinned === false ||
    change.sectionId != null
  ) {
    throw new Error("Chippi must keep its name and remain pinned outside sections.");
  }
}
