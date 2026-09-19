/**
 * Everything a new run can decide from the user's task, asked once.
 *
 * Routing, skill suggestion and company focus used to be three requests about the
 * same sentence. TypeSafe's own measurement is that thirteen questions over one
 * document in a single request are 10x faster than thirteen requests, because the
 * state is paid for once and the questions run in parallel. The first-action
 * choice and any URLs already in the message ride along for the same reason.
 *
 * Code consumes what applies. A hedge, a missing provider, or an option that was
 * never offered leaves that field unset so the caller keeps the behaviour it had.
 */

import { actionableChoice, choice, DECISION_ABSTAIN, DECISION_CONFIDENCE, noul } from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

type ModelCandidate = { model: string; description: string };
type SuggestableSkill = { name: string; description: string };

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

const MAX_SKILLS = 30;
const MAX_TASK_CHARS = 4_000;
const MAX_DESCRIPTION_CHARS = 240;
const MAX_URLS = 5;

export const FIRST_ACTIONS = {
  answer: "Reply from the thread and memory. No tool is needed.",
  search: "Look the question up with web search.",
  fetch: "Read a URL that is already in the request.",
  browse: "Act in the live browser on a page that is already open or must be used.",
  computer: "Use the computer: files, shell, or the desktop.",
  skill: "Follow a catalog skill that matches this request.",
  company: "Read Company OS records first.",
  code: "Judge code: find files, check a diff, or triage a failure log.",
} as const;

export type FirstAction = keyof typeof FIRST_ACTIONS;

export type RunStartDecision = {
  model?: string;
  skill?: string;
  companyFocus?: CompanyFocusArea;
  first?: FirstAction;
  fetchUrl?: string;
};

/** http(s) URLs already written in the task, so a fetch can point instead of invent. */
export function extractTaskUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const cleaned = found.map((url) => url.replace(/[),.;]+$/u, "")).filter((url) => url.length > 8);
  return [...new Set(cleaned)].slice(0, MAX_URLS);
}

export async function decideRunStart(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    candidates?: ModelCandidate[];
    fallbackModel?: string;
    skills?: SuggestableSkill[];
    company?: boolean;
    urls?: string[];
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<RunStartDecision> {
  const task = input.task.trim();
  if (!provider || !task) return {};

  const candidates = (input.candidates ?? []).filter(
    (candidate) => candidate.model.trim() && candidate.description.trim(),
  );
  const skills = (input.skills ?? []).filter((skill) => skill.name.trim()).slice(0, MAX_SKILLS);
  const urls = (input.urls ?? extractTaskUrls(task)).slice(0, MAX_URLS);

  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
    first: choice(
      {
        task: "What should this run do first?",
        rules: [
          "Pick the cheapest first step that serves the request.",
          "Use answer when the thread and memory already have what is needed.",
          "Use fetch only when a URL in the request should be read first.",
          "Prefer none_of_these over a stretch.",
        ],
      },
      { ...FIRST_ACTIONS, [DECISION_ABSTAIN]: "The first step is not one of these." },
    ),
  };

  if (candidates.length >= 2) {
    questions.model = choice(
      {
        task: "Which model should serve this request?",
        rules: [
          "Choose the cheapest model that can do this task well.",
          "Reserve a stronger model for work that genuinely needs it: long multi-step reasoning, careful code, or subtle judgement.",
          "A short answer, a lookup, a summary, or a routine check does not need a frontier model.",
        ],
      },
      Object.fromEntries(candidates.map((candidate) => [candidate.model, candidate.description])),
    );
  }

  if (skills.length > 0) {
    questions.needed = noul("Does this request need a catalog skill before acting?", {
      true: "A saved recipe clearly matches the request and should be read first.",
      false: "The request is a one-off, or no catalog skill would change what happens next.",
    });
    questions.skill = choice(
      {
        task: "Which catalog skill should be read for this request?",
        rules: [
          "Pick a skill only when its description matches the request.",
          "Prefer none_of_these over a loose match.",
        ],
      },
      {
        ...Object.fromEntries(
          skills.map((skill) => [
            skill.name,
            skill.description.trim().slice(0, MAX_DESCRIPTION_CHARS) || skill.name,
          ]),
        ),
        [DECISION_ABSTAIN]: "No catalog skill is a better fit than working without one.",
      },
    );
  }

  if (input.company) {
    questions.focus = choice(
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
    );
  }

  if (urls.length > 0) {
    questions.fetch_url = choice(
      {
        task: "If a URL in the request should be read first, which one?",
        rules: ["Pick a URL only when the request is to read that page.", "Prefer none_of_these."],
      },
      {
        ...Object.fromEntries(urls.map((url) => [url, url])),
        [DECISION_ABSTAIN]: "None of these URLs should be fetched first.",
      },
    );
  }

  const result = await provider.decide({
    state: {
      task: task.slice(0, MAX_TASK_CHARS),
      ...(skills.length > 0
        ? {
            skills: skills.map((skill) => ({
              name: skill.name,
              description: skill.description.slice(0, MAX_DESCRIPTION_CHARS),
            })),
          }
        : {}),
      ...(urls.length > 0 ? { urls } : {}),
    },
    questions,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) return {};

  const decided: RunStartDecision = {};

  if (candidates.length >= 2) {
    const chosen = actionableChoice(
      result.answers.model,
      candidates.map((candidate) => candidate.model),
      DECISION_CONFIDENCE.routing,
    );
    if (chosen && chosen !== input.fallbackModel) decided.model = chosen;
  }

  if (skills.length > 0) {
    const needed = result.answers.needed;
    if (needed?.type === "noul" && needed.noul >= DECISION_CONFIDENCE.routing) {
      const skill = actionableChoice(
        result.answers.skill,
        skills.map((entry) => entry.name),
        DECISION_CONFIDENCE.routing,
      );
      if (skill) decided.skill = skill;
    }
  }

  if (input.company) {
    const focus = actionableChoice(
      result.answers.focus,
      Object.keys(COMPANY_FOCUS_AREAS),
      DECISION_CONFIDENCE.routing,
    );
    if (focus) decided.companyFocus = focus as CompanyFocusArea;
  }

  const first = actionableChoice(
    result.answers.first,
    Object.keys(FIRST_ACTIONS),
    DECISION_CONFIDENCE.routing,
  );
  if (first) decided.first = first as FirstAction;

  if (urls.length > 0) {
    const fetchUrl = actionableChoice(result.answers.fetch_url, urls, DECISION_CONFIDENCE.routing);
    if (fetchUrl && (decided.first === "fetch" || decided.first === undefined)) {
      decided.fetchUrl = fetchUrl;
      decided.first ??= "fetch";
    }
  }

  return decided;
}

/** Short enough that the user's own wording is the search query — Jev cannot invent one. */
export const SEARCH_PREFETCH_MAX_CHARS = 400;

export function searchQueryForStart(task: string): string | undefined {
  const trimmed = task.trim();
  if (!trimmed || trimmed.length > SEARCH_PREFETCH_MAX_CHARS) return undefined;
  return trimmed;
}

/**
 * Skills whose bodies are already in memory and should be injected instead of
 * waiting for a skill_read generation.
 */
export function skillsImpliedByStart(start: RunStartDecision): string[] {
  const names: string[] = [];
  if (start.skill) names.push(start.skill);
  if (start.first === "company" || start.companyFocus) names.push("company-context");
  if (start.first === "code") names.push("symbolic");
  return [...new Set(names)];
}
