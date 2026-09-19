import { parseSkillMd, type SkillRecord } from "./agent-skill.js";

export type PluginFile = { path: string; content: string };
export type PluginBundle = { format: "cadre-plugin-v1"; files: PluginFile[] };
export const PLUGIN_BUNDLE_MAX_BYTES = 20_000_000;
const unsafePathCharacters = (value: string) =>
  [...value].some((character) => character === "\\" || character.charCodeAt(0) < 32);

/** Bundles are stored documents. Importing never executes hooks or installs servers. */
export function validatePluginBundle(raw: unknown): PluginBundle {
  if (!raw || typeof raw !== "object" || !("files" in raw) || !Array.isArray(raw.files)) {
    throw new Error("Choose a plugin folder containing SKILL.md files and their references.");
  }
  if (!raw.files.length || raw.files.length > 5000)
    throw new Error("Import between 1 and 5000 files.");
  const paths = new Set<string>();
  let bytes = 0;
  let skills = 0;
  const files = raw.files.map((file: unknown) => {
    if (
      !file ||
      typeof file !== "object" ||
      !("path" in file) ||
      !("content" in file) ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    )
      throw new Error("Invalid plugin file.");
    const path = file.path;
    if (
      !path ||
      path.length > 512 ||
      unsafePathCharacters(path) ||
      path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      /^[a-z]:/i.test(path)
    ) {
      throw new Error("Plugin files must use relative paths inside the selected folder.");
    }
    if (
      path
        .split("/")
        .some((part) => [".git", "node_modules", ".env"].includes(part) || part.startsWith(".env."))
    ) {
      throw new Error(`Remove private or dependency files before importing: ${path}`);
    }
    if (paths.has(path)) throw new Error(`Duplicate plugin file: ${path}`);
    paths.add(path);
    // Count UTF-8 without relying on browser globals in the native runtime.
    for (const character of path + file.content) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    if (bytes > PLUGIN_BUNDLE_MAX_BYTES)
      throw new Error("Plugin documents must total 20 MB or less.");
    if (file.content.includes("\0")) throw new Error(`Import text files only: ${path}`);
    if (path === "SKILL.md" || path.endsWith("/SKILL.md")) {
      const parsed = parseSkillMd(file.content);
      if ("error" in parsed) throw new Error(`${path}: ${parsed.error}`);
      skills++;
    }
    return { path, content: file.content };
  });
  if (!skills) throw new Error("The folder must contain at least one SKILL.md.");
  const bundle: PluginBundle = { format: "cadre-plugin-v1", files };
  entrypointFiles(bundle);
  return bundle;
}

/**
 * Read a bundle that validatePluginBundle already accepted at install time.
 * Only the shape is checked here: the full walk (byte counting, path policy,
 * every SKILL.md parse) runs once at install, not on every run or skill call.
 */
export function readPluginBundle(raw: unknown): PluginBundle {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("format" in raw) ||
    raw.format !== "cadre-plugin-v1" ||
    !("files" in raw) ||
    !Array.isArray(raw.files)
  ) {
    throw new Error("Plugin bundle is not installed.");
  }
  const files = raw.files.map((file: unknown): PluginFile => {
    if (
      !file ||
      typeof file !== "object" ||
      !("path" in file) ||
      !("content" in file) ||
      typeof file.path !== "string" ||
      typeof file.content !== "string"
    )
      throw new Error("Invalid plugin file.");
    return { path: file.path, content: file.content };
  });
  return { format: "cadre-plugin-v1", files };
}

function entrypointFiles(bundle: PluginBundle): PluginFile[] {
  const all = bundle.files.filter(
    (file) => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"),
  );
  const manifest = bundle.files.find(
    (file) =>
      file.path === ".codex-plugin/plugin.json" || file.path === ".claude-plugin/plugin.json",
  );
  if (!manifest) return all;
  let declared: unknown;
  try {
    declared = JSON.parse(manifest.content).skills;
  } catch {
    throw new Error("Invalid plugin manifest JSON.");
  }
  const roots = (
    typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared : ["skills"]
  )
    .filter((root): root is string => typeof root === "string")
    .map((root) => root.replace(/^\.\//, "").replace(/\/$/, ""));
  const selected = all.filter((file) =>
    roots.some((root) => file.path === root || file.path.startsWith(`${root}/`)),
  );
  if (!selected.length)
    throw new Error("No SKILL.md files match the plugin manifest's skills path.");
  return selected;
}

export function pluginSkillRecords(plugin: {
  id: string;
  name: string;
  config: unknown;
}): Array<SkillRecord & { id: string }> {
  if (
    !plugin.config ||
    typeof plugin.config !== "object" ||
    !("format" in plugin.config) ||
    plugin.config.format !== "cadre-plugin-v1"
  )
    return [];
  let bundle: PluginBundle;
  try {
    bundle = readPluginBundle(plugin.config);
  } catch {
    return [];
  }
  let entries: Array<{
    file: PluginFile;
    parsed: Exclude<ReturnType<typeof parseSkillMd>, { error: string }>;
  }>;
  try {
    entries = entrypointFiles(bundle).flatMap((file) => {
      const parsed = parseSkillMd(file.content);
      return "error" in parsed ? [] : [{ file, parsed }];
    });
  } catch {
    // A bundle with a malformed manifest never passed install; treat it as empty.
    return [];
  }
  const counts = new Map<string, number>();
  for (const { parsed } of entries)
    counts.set(parsed.name.toLowerCase(), (counts.get(parsed.name.toLowerCase()) ?? 0) + 1);
  return entries.flatMap(({ file, parsed }) => {
    const duplicate = (counts.get(parsed.name.toLowerCase()) ?? 0) > 1;
    const name = `${plugin.name}/${parsed.name}${duplicate ? ` (${file.path})` : ""}`;
    return [
      {
        id: `plugin:${plugin.id}:${file.path}`,
        name,
        description: parsed.description,
        content: file.content,
        source: "plugin" as const,
        readOnly: true,
      },
    ];
  });
}

export function resolvePluginResource(entryPath: string, resource: string): string {
  if (
    !resource ||
    resource.startsWith("/") ||
    unsafePathCharacters(resource) ||
    /^[a-z][a-z\d+.-]*:/i.test(resource)
  )
    throw new Error("Use a relative path within this plugin.");
  const parts = entryPath.split("/").slice(0, -1);
  for (const part of resource.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("The reference leaves this plugin.");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
