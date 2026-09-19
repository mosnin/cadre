import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("Render hosted start", () => {
  it("prepares @cadre/db before the API and worker start", () => {
    const start = readFileSync(path.join(repoRoot, "infra/render-start.mjs"), "utf8");
    const blueprint = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
    expect(start).toContain('["--filter", "@cadre/db"');
    expect(start).toContain("generate");
    expect(start).toContain("migrate");
    expect(start).not.toContain("@rakazo");
    expect(blueprint).toContain("@cadre/db generate");
    expect(blueprint).toContain("@cadre/db migrate");
    expect(blueprint).not.toContain("@rakazo");
  });
});
