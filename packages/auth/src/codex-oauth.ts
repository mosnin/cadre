import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "@rakazo/db";

export const CODEX_CLIENT = "cadre-codex-local";
export const READ_ROUTES = [
  "me",
  "spaces/list",
  "bots/list",
  "bots/get",
  "groups/list",
  "threads/get",
  "threads/messages",
  "computer/status",
  "runs/list",
  "search/query",
  "models/list",
];
export const EXECUTE_ROUTES = ["threads/send", "threads/stop", "computer/boot", "computer/stop"];
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (prefix: string) => prefix + randomBytes(32).toString("base64url");
export function validRedirect(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "http:" &&
      ["127.0.0.1", "[::1]"].includes(u.hostname) &&
      Number(u.port) >= 1024 &&
      Number(u.port) <= 65535 &&
      u.pathname === "/oauth/callback" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}
export type AuthorizationRequest = Record<string, string> & {
  client_id: string;
  response_type: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
  state: string;
};
export function validRequest(
  p: Record<string, string>,
  resource: string,
): p is AuthorizationRequest {
  return (
    p.client_id === CODEX_CLIENT &&
    p.response_type === "code" &&
    validRedirect(p.redirect_uri ?? "") &&
    /^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? "") &&
    p.code_challenge_method === "S256" &&
    ["cadre:read", "cadre:read cadre:execute"].includes(p.scope ?? "") &&
    p.resource === resource &&
    typeof p.state === "string" &&
    p.state.length > 0 &&
    p.state.length <= 1024
  );
}
export function allowsRoute(scope: string, pathname: string) {
  const route = pathname.startsWith("/rpc/") ? pathname.slice(5) : "";
  return (
    READ_ROUTES.includes(route) ||
    (scope === "cadre:read cadre:execute" && EXECUTE_ROUTES.includes(route))
  );
}
export function createCodexOAuth(pool: Pool) {
  return {
    async approve(userId: string, p: AuthorizationRequest) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "codex-consent:" + userId,
        ]);
        const active = await db.query(
          'SELECT id FROM "user" WHERE id=$1 AND "suspendedAt" IS NULL FOR SHARE',
          [userId],
        );
        const recent = await db.query(
          'SELECT count(*)::int AS count FROM "CodexOAuthGrant" WHERE "userId"=$1 AND "createdAt">now()-interval \'1 hour\'',
          [userId],
        );
        if (!active.rowCount || recent.rows[0].count >= 20) throw new Error("consent_unavailable");
        const code = secret("cdr_ac_");
        await db.query(
          'INSERT INTO "CodexOAuthGrant" (id,"userId",scope,"redirectUri",challenge,"codeHash","codeExpiresAt","expiresAt") VALUES ($1,$2,$3,$4,$5,$6,now()+interval \'5 minutes\',now()+interval \'30 days\')',
          [randomUUID(), userId, p.scope, p.redirect_uri, p.code_challenge, hash(code)],
        );
        // Bounded expiry maintenance does not retain secrets or unbounded refresh history.
        await db.query(
          'DELETE FROM "CodexOAuthGrant" WHERE id IN (SELECT id FROM "CodexOAuthGrant" WHERE "expiresAt"<now() LIMIT 100)',
        );
        await db.query("COMMIT");
        const redirect = new URL(p.redirect_uri);
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", p.state);
        return redirect.toString();
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },
    async exchange(p: Record<string, string>) {
      if (
        p.client_id !== CODEX_CLIENT ||
        !["authorization_code", "refresh_token"].includes(p.grant_type ?? "")
      )
        return null;
      if (
        p.grant_type === "authorization_code" &&
        (!p.code || !p.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier ?? ""))
      )
        return null;
      if (p.grant_type === "refresh_token" && !p.refresh_token) return null;
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const isCode = p.grant_type === "authorization_code";
        const digest = hash((isCode ? p.code : p.refresh_token) ?? "");
        const rows = isCode
          ? await db.query('SELECT g.* FROM "CodexOAuthGrant" g WHERE "codeHash"=$1 FOR UPDATE', [
              digest,
            ])
          : await db.query(
              'SELECT g.* FROM "CodexOAuthGrant" g WHERE "refreshHash"=$1 OR id IN (SELECT "grantId" FROM "CodexOAuthSpent" WHERE hash=$1) FOR UPDATE',
              [digest],
            );
        const g = rows.rows[0];
        const refuse = async () => {
          await db.query("COMMIT");
          return null;
        };
        if (!g || g.revokedAt || new Date(g.expiresAt).getTime() <= Date.now()) return refuse();
        const active = await db.query(
          'SELECT id FROM "user" WHERE id=$1 AND "suspendedAt" IS NULL FOR SHARE',
          [g.userId],
        );
        if (!active.rowCount) return refuse();
        if (isCode) {
          const challenge = createHash("sha256")
            .update(p.code_verifier ?? "")
            .digest("base64url");
          if (
            g.redirectUri !== p.redirect_uri ||
            g.challenge.length !== challenge.length ||
            !timingSafeEqual(Buffer.from(g.challenge), Buffer.from(challenge))
          )
            return refuse();
          if (g.codeUsedAt) {
            await db.query('UPDATE "CodexOAuthGrant" SET "revokedAt"=now() WHERE id=$1', [g.id]);
            return refuse();
          }
          if (new Date(g.codeExpiresAt).getTime() <= Date.now()) return refuse();
          await db.query('UPDATE "CodexOAuthGrant" SET "codeUsedAt"=now() WHERE id=$1', [g.id]);
        } else {
          if (g.refreshHash !== digest) {
            await db.query('UPDATE "CodexOAuthGrant" SET "revokedAt"=now() WHERE id=$1', [g.id]);
            return refuse();
          }
          const recent = await db.query(
            'SELECT count(*)::int AS count FROM "CodexOAuthSpent" WHERE "grantId"=$1 AND "createdAt">now()-interval \'1 hour\'',
            [g.id],
          );
          if (recent.rows[0].count >= 60) return refuse();
          await db.query('INSERT INTO "CodexOAuthSpent" (hash,"grantId") VALUES ($1,$2)', [
            digest,
            g.id,
          ]);
        }
        const access = secret("cdr_at_"),
          refresh = secret("cdr_rt_");
        const expiry = Math.min(Date.now() + 3600000, new Date(g.expiresAt).getTime());
        await db.query(
          'UPDATE "CodexOAuthGrant" SET "accessHash"=$2,"accessExpiresAt"=$3,"refreshHash"=$4 WHERE id=$1',
          [g.id, hash(access), new Date(expiry), hash(refresh)],
        );
        await db.query("COMMIT");
        return {
          access_token: access,
          refresh_token: refresh,
          token_type: "Bearer",
          scope: g.scope,
          expires_in: Math.max(1, Math.floor((expiry - Date.now()) / 1000)),
        };
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },
    async authenticate(token: string, pathname: string) {
      if (!/^cdr_at_[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const rows = await pool.query(
        'SELECT g."userId",g.scope FROM "CodexOAuthGrant" g JOIN "user" u ON u.id=g."userId" WHERE "accessHash"=$1 AND "revokedAt" IS NULL AND "accessExpiresAt">now() AND "expiresAt">now() AND u."suspendedAt" IS NULL',
        [hash(token)],
      );
      const grant = rows.rows[0];
      return grant && allowsRoute(grant.scope, pathname)
        ? { userId: String(grant.userId), scope: String(grant.scope) }
        : null;
    },
    async revoke(token: string) {
      await pool.query(
        'UPDATE "CodexOAuthGrant" SET "revokedAt"=now() WHERE "accessHash"=$1 OR "refreshHash"=$1 OR id IN (SELECT "grantId" FROM "CodexOAuthSpent" WHERE hash=$1)',
        [hash(token)],
      );
    },
  };
}
