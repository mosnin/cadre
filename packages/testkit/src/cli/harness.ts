import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadRootEnv } from "@cadre/core/node/load-root-env";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

loadRootEnv();

const runtimeArg = process.argv.find((arg) => arg.startsWith("--runtime="));
const agentRuntime = runtimeArg?.slice("--runtime=".length) ?? "scripted";

if (!process.argv.includes("--integration")) {
  throw new Error("Pass --integration");
}
if (agentRuntime !== "pi" && agentRuntime !== "scripted") {
  throw new Error('Runtime must be "pi" or "scripted"');
}

async function main() {
  const mode = "integration";
  const reportDir = path.resolve("test-report", mode);
  await mkdir(reportDir, { recursive: true });
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  try {
    const databaseUrl = container.getConnectionUri();
    const apiPort = Number(process.env.API_PORT ?? 3110);
    const webOrigin = "http://127.0.0.1:5180";

    process.env.DATABASE_URL = databaseUrl;
    process.env.VERIFY_DATABASE = "1";
    process.env.WAKEUP_DRIVER = "memory";
    process.env.SANDBOX_PROVIDER = "fake";
    process.env.AGENT_RUNTIME = agentRuntime;
    process.env.COMPOSIO_API_KEY = "";
    process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-32chars!";
    process.env.ENCRYPTION_KEY = "test-encryption-key-test-encryption-key";
    process.env.SANDBOX_SUPERVISOR_TOKEN = "test-supervisor-token-test-32chars";
    process.env.SCREEN_PROXY_SECRET = "test-screen-proxy-secret-test-32chars";
    process.env.BETTER_AUTH_URL = webOrigin;
    process.env.WEB_ORIGIN = webOrigin;
    process.env.API_PORT = String(apiPort);
    process.env.API_URL = `http://127.0.0.1:${apiPort}`;
    process.env.DATA_DIR = path.join(reportDir, "data");
    process.env.SIGNUPS_ENABLED = "true";
    process.env.SIGNUP_ALLOWLIST = "";
    process.env.CI = "1";

    execSync("pnpm --filter @cadre/db generate", { stdio: "inherit", env: process.env });
    execSync("pnpm --filter @cadre/db exec prisma migrate deploy", {
      stdio: "inherit",
      env: process.env,
      cwd: path.resolve("packages/db"),
    });

    execSync(
      [
        "pnpm exec vitest run --no-file-parallelism",
        "packages/testkit/src/journeys.test.ts",
        "packages/testkit/src/authorization.test.ts",
        "packages/testkit/src/admin.test.ts",
        "packages/testkit/src/attachments.test.ts",
        "packages/testkit/src/voice.test.ts",
        "packages/testkit/src/search.test.ts",
        "packages/testkit/src/executor-lifecycle.test.ts",
        "packages/testkit/src/connections.test.ts",
        "packages/db/src/space-membership.postgres.test.ts",
        "packages/adapters/src/company-workspaces.postgres.test.ts",
        "packages/adapters/src/workspace-integrations.postgres.test.ts",
        "packages/adapters/src/wakeup.postgres.test.ts",
        "packages/adapters/src/realtime.postgres.test.ts",
        "packages/adapters/src/job-reconciler.postgres.test.ts",
        "packages/adapters/src/model-oauth-storage.postgres.test.ts",
        "apps/api/src/thread-message-pages.postgres.test.ts",
        "apps/api/src/codex-oauth.postgres.test.ts",
        "packages/adapters/src/child-bots-delete.postgres.test.ts",
        "packages/adapters/src/computer-startup.postgres.test.ts",
      ].join(" "),
      {
        stdio: "inherit",
        env: process.env,
      },
    );
    await writeSummary(reportDir, {
      ok: true,
      mode,
      sandbox: process.env.SANDBOX_PROVIDER,
      runtime: process.env.AGENT_RUNTIME,
    });
  } finally {
    await container.stop().catch(() => undefined);
  }
}

async function writeSummary(reportDir: string, summary: Record<string, unknown>) {
  await writeFile(
    path.join(reportDir, "summary.json"),
    JSON.stringify({ ...summary, at: new Date().toISOString() }, null, 2),
  );
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
