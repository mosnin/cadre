/**
 * Bounded coding judgments: find files, check a diff, triage failures.
 *
 * These are the four workflows jev-code exposes as a CLI, written as Cadre tools.
 * Code gathers the evidence the caller already holds (paths, a diff, a log). Jev
 * answers fixed questions about each piece. The report lists findings; it never
 * says the change passed. Foreman-style floor assessment lives in decision-guards.
 */

import {
  actionableChoice,
  answerConfidence,
  choice,
  DECISION_CONFIDENCE,
  type NoulAnswer,
  noul,
  type ScoreAnswer,
  score,
} from "@cadre/core";
import type { DecisionProvider } from "./jev-decisions.js";

const MAX_FILES = 20;
const MAX_HUNKS = 16;
const MAX_FAILURES = 12;
const EXCERPT_CHARS = 700;
const MAX_TASK_CHARS = 2_000;

const RELEVANCE_LEVELS = [
  "Nothing to do with this task.",
  "Same area of the codebase, but not needed for the task.",
  "Useful background for the task.",
  "Directly involved in the task.",
];

export type SymbolicFile = { path: string; excerpt: string };

export type SymbolicFinding = {
  kind: "file" | "hunk" | "failure";
  path?: string;
  detail: string;
  score?: number;
};

export type SymbolicReport = {
  workflow: "find" | "check" | "triage";
  findings: SymbolicFinding[];
  notChecked: string[];
};

function noulValue(answer: unknown): number | undefined {
  const value = answer as NoulAnswer | undefined;
  if (value?.type !== "noul") return undefined;
  return typeof value.noul === "number" && Number.isFinite(value.noul) ? value.noul : undefined;
}

function scored(answer: unknown): number | undefined {
  const value = answer as ScoreAnswer | undefined;
  if (typeof value?.score !== "number" || !Number.isFinite(value.score)) return undefined;
  if (answerConfidence(value) < DECISION_CONFIDENCE.advisory) return undefined;
  return Math.max(0, Math.min(RELEVANCE_LEVELS.length - 1, value.score));
}

/** Split a unified diff into bounded hunks. Exact path comes from the diff header when present. */
export function splitDiffHunks(diff: string): { path: string; text: string }[] {
  const hunks: { path: string; text: string }[] = [];
  let path = "unknown";
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0 || hunks.length >= MAX_HUNKS) return;
    hunks.push({ path, text: buffer.join("\n").slice(0, EXCERPT_CHARS) });
    buffer = [];
  };
  for (const line of diff.split(/\r?\n/)) {
    const file = /^(?:diff --git a\/\S+ b\/|--- a\/|\+\+\+ b\/)(\S+)/.exec(line);
    if (file) {
      flush();
      path = file[1] ?? path;
      continue;
    }
    if (line.startsWith("@@")) {
      flush();
      buffer.push(line);
      continue;
    }
    if (buffer.length > 0) buffer.push(line);
  }
  flush();
  return hunks;
}

/** Split a test or CI log into separate failure bodies. */
export function splitFailures(log: string): string[] {
  const blocks = log
    .split(/\n(?=(?:FAIL|ERROR|●|✗|×)\b)/i)
    .map((block) => block.trim())
    .filter((block) => block.length > 20);
  const picked = (blocks.length > 1 ? blocks : [log.trim()]).slice(0, MAX_FAILURES);
  return picked.map((block) => block.slice(0, EXCERPT_CHARS));
}

function deterministicCheckFlags(diff: string): SymbolicFinding[] {
  const findings: SymbolicFinding[] = [];
  if (/\b(?:it|test|describe)\.(?:skip|only)\b/.test(diff)) {
    findings.push({ kind: "hunk", detail: "A test was skipped or narrowed with .skip / .only." });
  }
  if (/^-\s*(?:expect|assert)/m.test(diff) && !/^\+\s*(?:expect|assert)/m.test(diff)) {
    findings.push({ kind: "hunk", detail: "An assertion looks like it was removed." });
  }
  if (/^--- a\/.*(?:package-lock|pnpm-lock|yarn\.lock)/m.test(diff)) {
    findings.push({ kind: "hunk", detail: "A lockfile changed." });
  }
  return findings;
}

export async function rankCodeFiles(
  provider: DecisionProvider | undefined,
  input: {
    task: string;
    files: SymbolicFile[];
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<SymbolicReport> {
  const files = input.files
    .filter((file) => file.path.trim())
    .slice(0, MAX_FILES)
    .map((file) => ({
      path: file.path.trim(),
      excerpt: file.excerpt.replace(/\s+/g, " ").slice(0, EXCERPT_CHARS),
    }));
  const notChecked: string[] = [];
  if (input.files.length > MAX_FILES) {
    notChecked.push(`Only the first ${MAX_FILES} files were scored.`);
  }
  if (!provider || files.length === 0) {
    return { workflow: "find", findings: [], notChecked };
  }

  const result = await provider.decide({
    state: {
      task: input.task.trim().slice(0, MAX_TASK_CHARS),
      files: files.map((file, index) => ({ id: `f${index}`, ...file })),
    },
    questions: Object.fromEntries(
      files.map((_file, index) => [
        `f${index}`,
        score({ task: "How involved is this file in the task?" }, RELEVANCE_LEVELS),
      ]),
    ),
    sessionId: input.sessionId,
    signal: input.signal,
  });

  const findings: SymbolicFinding[] = [];
  if (result) {
    const ranked = files
      .map((file, index) => ({ file, index, score: scored(result.answers[`f${index}`]) }))
      .filter((entry) => entry.score !== undefined)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.index - right.index);
    for (const entry of ranked) {
      if ((entry.score ?? 0) < 2) continue;
      findings.push({
        kind: "file",
        path: entry.file.path,
        detail: RELEVANCE_LEVELS[entry.score!] ?? "Related to the task.",
        score: entry.score,
      });
    }
  }
  if (findings.length === 0) notChecked.push("No file scored as involved in the task.");
  return { workflow: "find", findings, notChecked };
}

export async function checkDiffAgainstTask(
  provider: DecisionProvider | undefined,
  input: { task: string; diff: string; sessionId?: string; signal?: AbortSignal },
): Promise<SymbolicReport> {
  const findings = deterministicCheckFlags(input.diff);
  const hunks = splitDiffHunks(input.diff);
  const notChecked: string[] = [];
  if (!input.diff.trim()) notChecked.push("No diff was supplied.");
  if (hunks.length === 0 && input.diff.trim()) {
    notChecked.push("The diff had no hunks that could be split.");
  }
  if (!provider || hunks.length === 0) {
    return { workflow: "check", findings, notChecked };
  }

  const questions: Record<string, ReturnType<typeof score> | ReturnType<typeof noul>> = {};
  for (const [index] of hunks.entries()) {
    questions[`h${index}`] = score(
      { task: "How related is this changed block to the task?" },
      RELEVANCE_LEVELS,
    );
    questions[`u${index}`] = noul("Is this changed block unrelated to the task?");
    questions[`w${index}`] = noul(
      "Does this changed block weaken tests (skip, delete an assertion, or empty a test)?",
    );
  }

  const result = await provider.decide({
    state: {
      task: input.task.trim().slice(0, MAX_TASK_CHARS),
      hunks: hunks.map((hunk, index) => ({ id: `h${index}`, path: hunk.path, text: hunk.text })),
    },
    questions,
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) {
    notChecked.push("The decision model did not judge the hunks.");
    return { workflow: "check", findings, notChecked };
  }

  for (const [index, hunk] of hunks.entries()) {
    const relevance = scored(result.answers[`h${index}`]);
    const unrelated = noulValue(result.answers[`u${index}`]);
    const weakened = noulValue(result.answers[`w${index}`]);
    if (unrelated !== undefined && unrelated >= DECISION_CONFIDENCE.routing) {
      findings.push({
        kind: "hunk",
        path: hunk.path,
        detail: "This change looks unrelated to the task.",
      });
    } else if (relevance === 0) {
      findings.push({
        kind: "hunk",
        path: hunk.path,
        detail: "This change scored as nothing to do with the task.",
      });
    }
    if (weakened !== undefined && weakened >= DECISION_CONFIDENCE.routing) {
      findings.push({
        kind: "hunk",
        path: hunk.path,
        detail: "This change may have weakened a test.",
      });
    }
  }
  return { workflow: "check", findings, notChecked };
}

const TRIAGE_KINDS = {
  caused_by_change: "This failure is caused by the current change.",
  pre_existing: "This failure was already there and is not from the change.",
  environment: "This failure is an environment, network, or infrastructure problem.",
  flake: "This failure looks intermittent.",
  unclear: "There is not enough in the log to say.",
};

export async function triageFailureLog(
  provider: DecisionProvider | undefined,
  input: {
    task?: string;
    log: string;
    diff?: string;
    sessionId?: string;
    signal?: AbortSignal;
  },
): Promise<SymbolicReport> {
  const failures = splitFailures(input.log);
  const notChecked: string[] = [];
  if (!input.log.trim()) notChecked.push("No log was supplied.");
  if (!provider || failures.length === 0) {
    return { workflow: "triage", findings: [], notChecked };
  }

  const result = await provider.decide({
    state: {
      task: (input.task ?? "").trim().slice(0, MAX_TASK_CHARS),
      diff: (input.diff ?? "").slice(0, 4_000),
      failures: failures.map((text, index) => ({ id: `e${index}`, text })),
    },
    questions: Object.fromEntries(
      failures.map((_text, index) => [
        `e${index}`,
        choice({ task: "What kind of failure is this?" }, TRIAGE_KINDS),
      ]),
    ),
    sessionId: input.sessionId,
    signal: input.signal,
  });
  if (!result) {
    notChecked.push("The decision model did not judge the failures.");
    return { workflow: "triage", findings: [], notChecked };
  }

  const findings: SymbolicFinding[] = [];
  for (const [index, text] of failures.entries()) {
    const kind = actionableChoice(
      result.answers[`e${index}`],
      Object.keys(TRIAGE_KINDS),
      DECISION_CONFIDENCE.advisory,
    );
    if (!kind) {
      notChecked.push(`Failure ${index + 1} was not classified.`);
      continue;
    }
    findings.push({
      kind: "failure",
      detail: `${TRIAGE_KINDS[kind as keyof typeof TRIAGE_KINDS]} ${text.slice(0, 160)}`,
    });
  }
  return { workflow: "triage", findings, notChecked };
}

export async function symbolicFromTool(
  provider: DecisionProvider | undefined,
  args: Record<string, unknown>,
  options: { sessionId?: string; signal?: AbortSignal } = {},
): Promise<SymbolicReport | { error: string }> {
  const workflow = String(args.workflow ?? "").trim();
  const task = String(args.task ?? "");
  if (workflow === "find") {
    const files = Array.isArray(args.files)
      ? args.files.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const record = entry as Record<string, unknown>;
          if (typeof record.path !== "string") return [];
          return [
            {
              path: record.path,
              excerpt: typeof record.excerpt === "string" ? record.excerpt : "",
            },
          ];
        })
      : [];
    if (files.length === 0) return { error: "symbolic_find needs files with a path." };
    return rankCodeFiles(provider, { task, files, ...options });
  }
  if (workflow === "check") {
    const diff = String(args.diff ?? "");
    if (!diff.trim()) return { error: "symbolic_check needs a diff." };
    return checkDiffAgainstTask(provider, { task, diff, ...options });
  }
  if (workflow === "triage") {
    const log = String(args.log ?? "");
    if (!log.trim()) return { error: "symbolic_triage needs a log." };
    return triageFailureLog(provider, {
      task,
      log,
      diff: typeof args.diff === "string" ? args.diff : undefined,
      ...options,
    });
  }
  return { error: "workflow must be find, check, or triage." };
}
