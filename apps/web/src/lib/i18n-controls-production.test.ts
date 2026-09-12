import { fileURLToPath } from "node:url";
import { createCompiledCatalog, getCatalogs } from "@lingui/cli/api";
import { getConfig } from "@lingui/conf";
import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";

it("renders control labels from compiled catalogs without development source fallbacks", async () => {
  const config = getConfig({ cwd: fileURLToPath(new URL("../..", import.meta.url)) });
  const [catalog] = await getCatalogs(config);
  const source = await catalog!.read("en");
  const labels = [
    "Schedules",
    "Account settings",
    "Custom plugins",
    "Source URL",
    "Apps",
    "Authentication",
    "Could not load custom plugins",
    "Cadre verifies the source before saving it. Credentials are encrypted and are never returned to clients or exposed to the model.",
  ];
  for (const locale of config.locales) {
    const { messages } = await catalog!.getTranslations(locale, {
      sourceLocale: "en",
      fallbackLocales: config.fallbackLocales || {},
    });
    const compiled = createCompiledCatalog(locale, messages, { namespace: "json" });
    expect(compiled.errors).toEqual([]);
    const i18n = setupI18n({
      locale,
      messages: { [locale]: JSON.parse(compiled.source).messages },
    });
    for (const label of labels) {
      const entry = Object.entries(source).find(([, message]) => message.message === label);
      expect(entry, `Missing production catalog entry: ${label}`).toBeDefined();
      const id = entry![0];
      expect(i18n._(id)).toBe(label);
    }
  }
});
