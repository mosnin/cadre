/**
 * Choose which Company OS records to read first.
 *
 * Company context is large and a generation that guesses the starting index wastes a
 * pull. One choice over the closed set of company areas — the same split as the
 * company-context skill — points the run at the records the task needs. A hedge
 * leaves the skill's own order alone.
 */

import { actionableChoice, choice, DECISION_ABSTAIN, DECISION_CONFIDENCE } from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

const MAX_TASK_CHARS = 2_000;

export const COMPANY_FOCUS_AREAS = {
  overview: "Company identity, name, and current scope of the grant.",
  goals: "Goals, strategy, and what the company is trying to do.",
  customers: "Customers, accounts, and people the work is for.",
  product: "Product, shipping, and what is being built.",
  constraints: "Constraints, policies, and things the work must not do.",
  decisions: "Prior decisions and the reasons they were made.",
  department: "A specific department or team the request names.",
} as const;

export type CompanyFocusArea = keyof typeof COMPANY_FOCUS_AREAS;

export async function suggestCompanyFocus(
  provider: DecisionProvider | undefined,
  input: { task: string; sessionId?: string; signal?: AbortSignal },
): Promise<CompanyFocusArea | undefined> {
  const task = input.task.trim();
  if (!provider || !task) return undefined;

  const result = await provider.decide({
    state: { task: task.slice(0, MAX_TASK_CHARS) },
    questions: {
      focus: choice(
        {
          task: "Which company records should be read first for this request?",
          rules: [
            "Pick the area the request is actually about.",
            "Use none_of_these when the request is not about company context.",
          ],
        },
        {
          ...COMPANY_FOCUS_AREAS,
          [DECISION_ABSTAIN]: "This request does not need company records.",
        },
      ),
    },
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return undefined;

  return actionableChoice(
    result.answers.focus,
    Object.keys(COMPANY_FOCUS_AREAS),
    DECISION_CONFIDENCE.routing,
  ) as CompanyFocusArea | undefined;
}
