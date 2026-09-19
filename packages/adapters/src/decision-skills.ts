/**
 * Pick at most one catalog skill for a turn.
 *
 * The agent otherwise browses the catalog with skill_read until something fits. That is a
 * generation per miss. One request asks whether a skill is needed at all and, speculatively,
 * which one — the same shape as TypeSafe's skill-suggestion cookbook. The name is a hint:
 * the agent still has to read the skill, and a hedged answer leaves the catalog alone.
 */

import { decideRunStart } from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";

export type SuggestableSkill = { name: string; description: string };

export async function suggestSkill(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    skills: SuggestableSkill[];
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<string | undefined> {
  if (!provider || !input.task.trim() || input.skills.length === 0) return undefined;
  const start = await decideRunStart(provider, {
    task: input.task,
    skills: input.skills,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  return start.skill;
}
