/** Isolated browser-test host. It always uses scripted models/fake computers and binds loopback. */
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const databaseUrl = process.env.CHIPPI_TEST_DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname))
  throw new Error("Chippi preview requires an isolated loopback test database");
const dataDir = await mkdtemp(join(tmpdir(), "chippi-workforce-qa-"));
Object.assign(process.env, {
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_SECRET: "test-only-auth-secret-".repeat(4),
  ENCRYPTION_KEY: "test-only-encryption-secret-".repeat(4),
  SCREEN_PROXY_SECRET: "test-only-screen-secret-".repeat(4),
  CHIPPI_WORKFORCE_SECRET: "test-only-workforce-secret-".repeat(4),
  CHIPPI_APP_ORIGIN: "http://127.0.0.1:3041",
  WEB_ORIGIN: "http://127.0.0.1:3041",
  API_URL: "http://127.0.0.1:3041",
  AGENT_RUNTIME: "scripted",
  SANDBOX_PROVIDER: "fake",
  WAKEUP_DRIVER: "memory",
  DATA_DIR: dataDir,
  LOG_LEVEL: "off",
  NODE_ENV: "development",
});
const { createApp } = await import(root + "/apps/api/src/app.ts");
const { signWorkforceRequest, verifyWorkforceRequest } = await import(
  root + "/packages/core/src/node/workforce-auth.ts"
);
const { app, stop } = await createApp();
const principal = {
  actorId: "qa-user",
  kind: "personal" as const,
  scopeId: "qa-workspace",
  name: "QA real estate workspace",
  role: "owner" as const,
};
const teamPrincipal = { actorId: 'qa-user', kind: 'team' as const, scopeId: 'qa-team', name: 'QA shared team', role: 'member' as const };
const workspaces = [
  { kind: 'personal', href: '/workforce/personal/qa/app', name: principal.name, role: 'Agent workspace' },
  { kind: 'team', href: '/workforce/team/qa-team/app', name: teamPrincipal.name, role: 'Team member' },
];
createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, "http://127.0.0.1:3041");
    const team = url.pathname.startsWith('/workforce/team/qa-team/') || url.pathname.startsWith('/api/workforce/team/qa-team/');
    const activePrincipal = team ? teamPrincipal : principal;
    const basePath = team ? '/workforce/team/qa-team' : '/workforce/personal/qa';
    const apiBase = '/api' + basePath;
    if (url.pathname.startsWith("/workforce-assets/")) {
      const file = decodeURIComponent(url.pathname.slice("/workforce-assets/".length));
      if (file.includes("..")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const body = await readFile(root + "/apps/web/dist/" + file);
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream",
      );
      res.end(body);
      return;
    }
    if (url.pathname.startsWith(apiBase + "/")) {
      const path = url.pathname.slice(apiBase.length) + url.search;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const name of ["content-type", "accept"])
        if (req.headers[name]) headers.set(name, String(req.headers[name]));
      headers.set(
        "x-chippi-authorization",
        signWorkforceRequest(
          process.env.CHIPPI_WORKFORCE_SECRET!,
          activePrincipal,
          req.method!,
          path,
          body,
        ),
      );
      const response = await app.request("http://localhost" + path, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method!) ? undefined : body,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
      return;
    }
    if (url.pathname === "/api/internal/workforce/authorize") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const verified = verifyWorkforceRequest(
        process.env.CHIPPI_WORKFORCE_SECRET!,
        String(req.headers["x-chippi-authorization"] ?? ""),
        "POST",
        url.pathname,
        body,
      );
      res.writeHead([principal.scopeId, teamPrincipal.scopeId].includes(verified.principal.scopeId) ? 204 : 403);
      res.end();
      return;
    }
    const html = await readFile(root + "/apps/web/dist/index.html", "utf8");
    const config = {
      kind: activePrincipal.kind,
      workspaces,
      basePath,
      apiBase,
      crmHref: team ? '/teams' : '/crm',
      name: activePrincipal.name,
      role: team ? 'Team member' : 'Agent workspace',
    };
    res.setHeader("Content-Type", "text/html");
    res.end(
      html
        .replace(/<title>.*?<\/title>/, "<title>Chippi Workforce · local QA</title>")
        .replace('<html lang="en">', '<html lang="en" data-chippi-host>')
        .replace(
          "</head>",
          `<script type="application/json" id="chippi-host">${JSON.stringify(config)}</script></head>`,
        ),
    );
  } catch (error) {
    res.writeHead(500);
    res.end("QA runtime error");
    console.error(error);
  }
}).listen(3041, "127.0.0.1");
process.on("SIGTERM", async () => {
  await stop();
  process.exit(0);
});
