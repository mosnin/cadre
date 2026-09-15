import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Optional provenance evidence from Rollup's real graph and rendered chunks. */
export function componentBuildReceipt(): Plugin {
  const project = path.resolve(import.meta.dirname, "../..");
  const hash = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
  const relativeSource = (id: string) => {
    if (id.includes("\0") || id.includes("?") || id.includes("/node_modules/")) return null;
    const relative = path.relative(project, id);
    if (relative.startsWith("..") || !existsSync(id) || !statSync(id).isFile()) return null;
    return relative;
  };
  return {
    name: "component-build-receipt",
    apply: "build",
    writeBundle(options, bundle) {
      if (process.env.COMPONENT_BUILD_RECEIPT !== "1") return;
      const directory = options.dir ?? path.join(project, "apps/web/dist");
      const receiptFile = path.join(directory, "component-build-receipt.json");
      const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
      receipt.outputs = Object.fromEntries(
        Object.values(bundle)
          .filter((output) => output.fileName !== "component-build-receipt.json")
          .map((output) => [
            `apps/web/dist/${output.fileName}`,
            hash(readFileSync(path.join(directory, output.fileName))),
          ]),
      );
      writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
    },
    generateBundle(_options, bundle) {
      if (process.env.COMPONENT_BUILD_RECEIPT !== "1") return;
      const source_hashes: Record<string, string> = {};
      const graph: Record<string, string[]> = {};
      const modules: Record<string, { sha256: string; rendered_length: number }> = {};
      const outputs: Record<string, string> = {};
      for (const id of this.getModuleIds()) {
        const relative = relativeSource(id);
        const info = this.getModuleInfo(id);
        if (!relative || !info) continue;
        source_hashes[relative] = hash(readFileSync(id));
        graph[relative] = [...info.importedIds, ...info.dynamicallyImportedIds]
          .map(relativeSource)
          .filter((value): value is string => value !== null);
      }
      for (const output of Object.values(bundle)) {
        outputs[`apps/web/dist/${output.fileName}`] = hash(
          output.type === "chunk" ? output.code : output.source,
        );
        if (output.type !== "chunk") continue;
        for (const [id, rendered] of Object.entries(output.modules)) {
          const relative = relativeSource(id);
          if (!relative || !source_hashes[relative]) continue;
          modules[relative] = {
            sha256: source_hashes[relative],
            rendered_length: (modules[relative]?.rendered_length ?? 0) + rendered.renderedLength,
          };
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "component-build-receipt.json",
        source: JSON.stringify(
          {
            entrypoints: ["apps/web/src/main.tsx"],
            source_hashes,
            graph,
            modules,
            outputs,
          },
          null,
          2,
        ),
      });
    },
  };
}
