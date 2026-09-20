/**
 * Choose which Company OS records to read first.
 *
 * Company context is large and a generation that guesses the starting index wastes a
 * pull. One choice over the closed set of company areas — the same split as the
 * company-context skill — points the run at the records the task needs. A hedge
 * leaves the skill's own order alone.
 */

import { type CompanyFocusArea, decideRunStart } from "./decision-start.js";
import type { DecisionProvider } from "./jev-decisions.js";

export { COMPANY_FOCUS_AREAS, type CompanyFocusArea } from "./decision-start.js";

export async function suggestCompanyFocus(
  provider: DecisionProvider | undefined,
  input: { task: string; sessionId?: string; signal?: AbortSignal },
): Promise<CompanyFocusArea | undefined> {
  if (!provider || !input.task.trim()) return undefined;
  const start = await decideRunStart(provider, {
    task: input.task,
    company: true,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  return start.companyFocus;
}
