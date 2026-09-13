import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  allowsRoute,
  CODEX_CLIENT,
  createCodexOAuth,
  validRequest,
} from "../../../apps/api/src/codex-oauth.js";

const databaseUrl = process.env.CODEX_OAUTH_TEST_DATABASE_URL;
const postgres = databaseUrl ? describe.sequential : describe.skip;
postgres("Codex grants in isolated PostgreSQL schema", () => {
  const schema = "codex_oauth_test_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString: databaseUrl });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const service = createCodexOAuth(pool);
  const verifier = "v".repeat(43),
    resource = "https://api.cadre.test/rpc";
  const request = {
    client_id: CODEX_CLIENT,
    response_type: "code",
    redirect_uri: "http://127.0.0.1:49152/oauth/callback",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: "cadre:read",
    resource,
    state: "fixture-state",
  };
  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "user" (id text PRIMARY KEY,"suspendedAt" timestamptz)');
    await pool.query(
      readFileSync(
        new URL(
          "../prisma/migrations/20260913020000_codex_rpc_oauth/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "user" CASCADE');
    await pool.query('INSERT INTO "user" (id) VALUES ($1)', ["actor"]);
  });
  async function grant(scope = "cadre:read") {
    const url = new URL(await service.approve("actor", { ...request, scope }));
    return {
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT,
      code: url.searchParams.get("code")!,
      redirect_uri: request.redirect_uri,
      code_verifier: verifier,
    };
  }
  it("validates native callback, PKCE, resource and closed operation scopes", () => {
    expect(validRequest(request, resource)).toBe(true);
    for (const patch of [
      { redirect_uri: "https://attacker.test" },
      { code_challenge_method: "plain" },
      { resource: "https://other.test" },
      { scope: "admin" },
    ])
      expect(validRequest({ ...request, ...patch }, resource)).toBe(false);
    expect(allowsRoute("cadre:read", "/rpc/spaces/list")).toBe(true);
    for (const path of [
      "/rpc/threads/send",
      "/rpc/admin/users",
      "/rpc/secrets/list",
      "/rpc/spaces/list/extra",
      "/rpc/%73paces/list",
    ])
      expect(allowsRoute("cadre:read", path)).toBe(false);
  });
  it("rejects mismatches without consuming and consumes a code once", async () => {
    const p = await grant();
    for (const patch of [
      { client_id: "other" },
      { redirect_uri: p.redirect_uri + "x" },
      { code_verifier: "x".repeat(43) },
    ])
      expect(await service.exchange({ ...p, ...patch })).toBeNull();
    const [first, second] = await Promise.all([service.exchange(p), service.exchange(p)]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await service.authenticate((first ?? second)!.access_token, "/rpc/me")).toBeNull();
  });
  it("rotates refresh and revokes the family on replay", async () => {
    const tokens = (await service.exchange(await grant()))!;
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toMatchObject({
      userId: "actor",
    });
    expect(await service.authenticate(tokens.access_token, "/rpc/threads/send")).toBeNull();
    const p = {
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT,
      refresh_token: tokens.refresh_token,
    };
    const next = (await service.exchange(p))!;
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toBeNull();
    expect(await service.authenticate(next.access_token, "/rpc/me")).not.toBeNull();
    expect(await service.exchange(p)).toBeNull();
    expect(await service.authenticate(next.access_token, "/rpc/me")).toBeNull();
  });
  it("supports execution consent without administrative access", async () => {
    const tokens = (await service.exchange(await grant("cadre:read cadre:execute")))!;
    expect(await service.authenticate(tokens.access_token, "/rpc/threads/send")).not.toBeNull();
    expect(await service.authenticate(tokens.access_token, "/rpc/admin/users")).toBeNull();
    await service.revoke(tokens.refresh_token);
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toBeNull();
  });
  it("rechecks suspension and grant expiry", async () => {
    const tokens = (await service.exchange(await grant()))!;
    await pool.query('UPDATE "user" SET "suspendedAt"=now()');
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toBeNull();
    expect(
      await service.exchange({
        grant_type: "refresh_token",
        client_id: CODEX_CLIENT,
        refresh_token: tokens.refresh_token,
      }),
    ).toBeNull();
    await pool.query('UPDATE "user" SET "suspendedAt"=NULL');
    await pool.query('UPDATE "CodexOAuthGrant" SET "expiresAt"=now()-interval \'1 second\'');
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toBeNull();
  });
  it("stores only digests and revokes access independently of browser sessions", async () => {
    const tokens = (await service.exchange(await grant()))!;
    const rows = await pool.query('SELECT * FROM "CodexOAuthGrant"');
    const persisted = JSON.stringify(rows.rows);
    expect(persisted).not.toContain(tokens.access_token);
    expect(persisted).not.toContain(tokens.refresh_token);
    await service.revoke(tokens.access_token);
    expect(await service.authenticate(tokens.access_token, "/rpc/me")).toBeNull();
  });
});
