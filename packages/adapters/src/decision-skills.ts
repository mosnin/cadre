/**
 * Pick at most one catalog skill for a turn.
 *
 * The agent otherwise browses the catalog with skill_read until something fits. That is a
 * generation per miss. One request asks whether a skill is needed at all and, speculatively,
 * which one — the same shape as TypeSafe's skill-suggestion cookbook. The name is a hint:
 * the agent still has to read the skill, and a hedged answer leaves the catalog alone.
 */

import { actionableChoice, choice, DECISION_ABSTAIN, DECISION_CONFIDENCE, noul } from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

const MAX_SKILLS = 30;
const MAX_TASK_CHARS = 2_000;
const MAX_DESCRIPTION_CHARS = 240;

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
  const task = input.task.trim();
  const skills = input.skills.filter((skill) => skill.name.trim()).slice(0, MAX_SKILLS);
  if (!provider || !task || skills.length === 0) return undefined;

  const criteria: Record<string, string> = {
    ...Object.fromEntries(
      skills.map((skill) => [
        skill.name,
        skill.description.trim().slice(0, MAX_DESCRIPTION_CHARS) || skill.name,
      ]),
    ),
    [DECISION_ABSTAIN]: "No catalog skill is a better fit than working without one.",
  };

  const result = await provider.decide({
    state: {
      task: task.slice(0, MAX_TASK_CHARS),
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description.slice(0, MAX_DESCRIPTION_CHARS),
      })),
    },
    questions: {
      needed: noul("Does this request need a catalog skill before acting?", {
        true: "A saved recipe clearly matches the request and should be read first.",
        false: "The request is a one-off, or no catalog skill would change what happens next.",
      }),
      skill: choice(
        {
          task: "Which catalog skill should be read for this request?",
          rules: [
            "Pick a skill only when its description matches the request.",
            "Prefer none_of_these over a loose match.",
          ],
        },
        criteria,
      ),
    },
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return undefined;

  const needed = result.answers.needed;
  if (needed?.type !== "noul" || needed.noul < DECISION_CONFIDENCE.routing) return undefined;

  const chosen = actionableChoice(
    result.answers.skill,
    skills.map((skill) => skill.name),
    DECISION_CONFIDENCE.routing,
  );
  return chosen;
}
