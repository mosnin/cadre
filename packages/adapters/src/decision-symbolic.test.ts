import { describe, expect, it, vi } from "vitest";
import {
  checkDiffAgainstTask,
  rankCodeFiles,
  splitDiffHunks,
  splitFailures,
  symbolicFromTool,
  triageFailureLog,
} from "./decision-symbolic.js";
import type { DecisionProvider } from "./jev-decisions.js";

function answering(answers: Record<string, unknown>): DecisionProvider {
  return { decide: vi.fn(async () => ({ answers: answers as never, model: "typesafe/jev-1.13" })) };
}

const DIFF = `diff --git a/src/parse.ts b/src/parse.ts
--- a/src/parse.ts
+++ b/src/parse.ts
@@ -1,3 +1,4 @@
 export function parse(raw: string) {
+  if (raw == null) return {};
   return JSON.parse(raw);
 }
`;

describe("splitting evidence", () => {
  it("cuts a unified diff into hunks with their path", () => {
    const hunks = splitDiffHunks(DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.path).toBe("src/parse.ts");
    expect(hunks[0]?.text).toContain("if (raw == null)");
  });

  it("splits a log on failure markers", () => {
    const failures = splitFailures("ok\nFAIL src/a.test.ts\nexpected 1\nFAIL src/b.test.ts\nboom");
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });
});

describe("finding files", () => {
  it("returns the files that bear on the task", async () => {
    const report = await rankCodeFiles(
      answering({
        f0: { type: "score", score: 3, confidence: 0.8 },
        f1: { type: "score", score: 0, confidence: 0.8 },
      }),
      {
        task: "null config crash",
        files: [
          { path: "src/parse.ts", excerpt: "parse raw json" },
          { path: "README.md", excerpt: "intro" },
        ],
      },
    );
    expect(report.workflow).toBe("find");
    expect(report.findings.map((finding) => finding.path)).toEqual(["src/parse.ts"]);
  });
});

describe("checking a diff", () => {
  it("flags a skipped test without asking the model", async () => {
    const report = await checkDiffAgainstTask(undefined, {
      task: "fix crash",
      diff: `${DIFF}\n+it.skip("still works", () => {});`,
    });
    expect(report.findings.some((finding) => finding.detail.includes("skipped"))).toBe(true);
  });

  it("flags a hunk the model calls unrelated", async () => {
    const report = await checkDiffAgainstTask(
      answering({
        h0: { type: "score", score: 0, confidence: 0.8 },
        u0: { type: "noul", noul: 0.9 },
        w0: { type: "noul", noul: 0.1 },
      }),
      { task: "fix crash", diff: DIFF },
    );
    expect(report.findings.some((finding) => finding.detail.includes("unrelated"))).toBe(true);
  });
});

describe("triaging failures", () => {
  it("labels each failure from the closed set", async () => {
    const report = await triageFailureLog(
      answering({
        e0: { type: "choice", choice: "environment", confidence: 0.8 },
      }),
      { log: "FAIL src/a.test.ts\nECONNRESET talking to ci" },
    );
    expect(report.findings[0]?.detail).toMatch(/environment/i);
  });
});

describe("the symbolic tool entry", () => {
  it("rejects an unknown workflow and missing evidence", async () => {
    await expect(symbolicFromTool(undefined, { workflow: "invent" })).resolves.toMatchObject({
      error: expect.stringContaining("workflow"),
    });
    await expect(symbolicFromTool(undefined, { workflow: "check" })).resolves.toMatchObject({
      error: expect.stringContaining("diff"),
    });
  });
});
