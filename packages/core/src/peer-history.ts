import { oneLine } from "./prompt-data.js";

/**
 * In a group the model's history must say who spoke. A message from another bot is not the
 * model's own earlier turn, so it becomes a user-role message labelled with the bot's name;
 * only the model's own bot messages stay assistant turns.
 */
export function attributePeerMessages<
  T extends { role: "user" | "assistant" | "system"; content: string; botId?: string | null },
>(messages: readonly T[], selfBotId: string, names: ReadonlyMap<string, string>): T[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || !message.botId || message.botId === selfBotId) {
      return message;
    }
    const name = oneLine(names.get(message.botId) ?? "another bot").replace(/[[\]]/g, "");
    return { ...message, role: "user" as const, content: `[${name}]: ${message.content}` };
  });
}
