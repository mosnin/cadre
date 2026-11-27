import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("./vercel-build.mjs", import.meta.url));

for (const marketing of ["https://marketing.example.com", ""]) {
  test(`gateway routing with marketing ${marketing ? "enabled" : "disabled"}`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "cadre-routing-"));
    try {
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
          const pattern = new RegExp(`^${route.src}$`);
          if (pattern.test(path)) return path.replace(pattern, route.dest);
        }
        return null;
      };
      for (const path of [
        "/api/auth/capabilities",
        "/api/auth/sign-in/email",
        "/api/auth/get-session",
        "/rpc/bots.list",
      ]) {
        assert.equal(resolve(path), `https://runtime.example.com${path}`, path);
      }
      for (const path of ["/", "/pricing", "/guides/first-task", "/privacy/", "/login", "/app"]) {
        assert.equal(resolve(path), marketing ? `${marketing}${path}` : null, path);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test("gateway refuses a runtime that is not an HTTPS origin", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cadre-routing-"));
  try {
    assert.throws(() =>
      execFileSync(process.execPath, [build], {
        cwd,
        env: { ...process.env, API_PROXY_TARGET: "http://runtime.example.com" },
        stdio: "pipe",
      }),
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
