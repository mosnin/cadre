import { describe, expect, it } from "vitest";
import {
  PLUGIN_BUNDLE_MAX_BYTES,
  pluginSkillRecords,
  readPluginBundle,
  resolvePluginResource,
  validatePluginBundle,
} from "./plugin-bundle.js";

const skill = "---\nname: design\ndescription: Design products\n---\nRead ../../kernel/guide.md";
describe("plugin document bundles", () => {
  it("reads an installed bundle by shape without re-running install validation", () => {
    const installed = validatePluginBundle({
      files: [{ path: "SKILL.md", content: skill }],
    });
    expect(readPluginBundle(installed)).toEqual(installed);
    expect(() => readPluginBundle({ files: [] })).toThrow("not installed");
    expect(() =>
      readPluginBundle({ format: "cadre-plugin-v1", files: [{ path: 1, content: "" }] }),
    ).toThrow("Invalid plugin file");
    expect(
      pluginSkillRecords({ id: "x", name: "X", config: { format: "cadre-plugin-v1" } }),
    ).toEqual([]);
  });
  it("preserves entrypoints and referenced files without executing configuration", () => {
    const bundle = validatePluginBundle({
      files: [
        { path: "skills/design/SKILL.md", content: skill },
        { path: "kernel/guide.md", content: "Guide" },
        { path: ".claude-plugin/plugin.json", content: '{"name":"design"}' },
      ],
    });
    expect(bundle.files).toHaveLength(3);
    expect(pluginSkillRecords({ id: "one", name: "Design", config: bundle })[0]).toMatchObject({
      id: "plugin:one:skills/design/SKILL.md",
      source: "plugin",
      readOnly: true,
      content: skill,
    });
    expect(resolvePluginResource("skills/design/SKILL.md", "../../kernel/guide.md")).toBe(
      "kernel/guide.md",
    );
    expect(resolvePluginResource("kernel/guide.md", "./more.md")).toBe("kernel/more.md");
  });
  it("enforces the byte limit for Unicode documents", () => {
    const path = "SKILL.md";
    const remaining = PLUGIN_BUNDLE_MAX_BYTES - path.length - skill.length;
    const content = skill + "🙂".repeat(Math.floor(remaining / 4)) + "a".repeat(remaining % 4);
    expect(validatePluginBundle({ files: [{ path, content }] }).files[0]?.content).toBe(content);
    expect(() => validatePluginBundle({ files: [{ path, content: content + "é" }] })).toThrow(
      "20 MB",
    );
  });
  it.each([
    "../escape",
    "/absolute",
    "C:/private",
    "a\\b",
    "a/../b",
    ".env",
    "nested/.env.local",
    "node_modules/a",
    "a\u0000b",
  ])("rejects unsafe import path %s", (path) => {
    expect(() => validatePluginBundle({ files: [{ path, content: skill }] })).toThrow();
  });
  it("rejects missing and invalid entrypoints and duplicate paths", () => {
    expect(() => validatePluginBundle({ files: [{ path: "guide.md", content: "hi" }] })).toThrow(
      "SKILL.md",
    );
    expect(() => validatePluginBundle({ files: [{ path: "SKILL.md", content: "hi" }] })).toThrow(
      "frontmatter",
    );
    expect(() =>
      validatePluginBundle({
        files: [
          { path: "SKILL.md", content: skill },
          { path: "SKILL.md", content: skill },
        ],
      }),
    ).toThrow("Duplicate");
  });
  it.each(["../../../private", "https://example.com", "/private", "C:/private", "..\\private"])(
    "rejects out-of-bundle reference %s",
    (path) => expect(() => resolvePluginResource("skills/design/SKILL.md", path)).toThrow(),
  );
});
