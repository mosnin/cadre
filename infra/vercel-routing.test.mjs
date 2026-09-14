import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("./vercel-build.mjs", import.meta.url));

for (const marketing of ["https://marketing.example.com", ""]) {
  test(`gateway routing with marketing ${marketing ? "enabled" : "disabled"}`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cadre-routing-"));
    try {
      await mkdir(join(cwd, "apps/web/dist/assets"), { recursive: true });
      await writeFile(join(cwd, "apps/web/dist/index.html"), "application shell");
      await writeFile(join(cwd, "apps/web/dist/assets/app.js"), "application script");
      execFileSync(process.execPath, [build], {
        cwd,
        env: {
          ...process.env,
          API_PROXY_TARGET: "https://runtime.example.com",
          MARKETING_ORIGIN: marketing,
        },
      });
      const config = JSON.parse(await readFile(join(cwd, ".vercel/output/config.json"), "utf8"));
      const resolve = (path) => {
        for (const route of config.routes) {
          if (route.handle === "filesystem") {
            if (["/assets/app.js", "/index.html"].includes(path)) return path;
            continue;
          }
          if (route.continue) continue;
          const pattern = new RegExp(`^${route.src}$`);
          if (pattern.test(path)) return path.replace(pattern, route.dest);
        }
      };
      for (const path of [
        "/",
        "/product/workers",
        "/product/computers",
        "/product/company-os",
        "/solutions/client-reporting",
        "/guides/first-task",
        "/about",
        "/pricing",
        "/pricing/",
        "/product/missing",
        "/_next/static/chunk.js",
        "/svg/logo.svg",
      ]) {
        assert.equal(resolve(path), marketing ? `${marketing}${path}` : "/index.html", path);
      }
      for (const path of [
        "/login",
        "/signup",
        "/sign-in",
        "/sign-up",
        "/forgot-password",
        "/reset-password",
        "/app",
        "/app/oauth/codex",
        "/productivity",
        "/pricing-settings",
      ]) {
        assert.equal(resolve(path), "/index.html", path);
      }
      for (const path of [
        "/api/auth/capabilities",
        "/api/auth/sign-in/email",
        "/api/auth/get-session",
        "/rpc/bots.list",
      ]) {
        assert.equal(resolve(path), `https://runtime.example.com${path}`, path);
      }
      assert.equal(resolve("/assets/app.js"), "/assets/app.js");
      assert.equal(
        await readFile(join(cwd, ".vercel/output/static/index.html"), "utf8"),
        "application shell",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
