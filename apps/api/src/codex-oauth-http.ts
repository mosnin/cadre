import type { Pool } from "@rakazo/db";
import type { Hono } from "hono";
import { CODEX_CLIENT, createCodexOAuth, validRequest } from "./codex-oauth.js";
import { readBoundedBody } from "./http-body.js";
export function mountCodexOAuth(
  app: Hono,
  options: {
    pool?: Pool;
    apiUrl: string;
    webOrigin: string;
    session: (headers: Headers) => Promise<{ user: { id: string; name: string } } | null>;
  },
) {
  const api = options.apiUrl.replace(/\/$/, ""),
    resource = api + "/rpc";
  const service = options.pool ? createCodexOAuth(options.pool) : null;
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  const parse = (text: string) => {
    const p = new URLSearchParams(text);
    for (const key of p.keys())
      if (p.getAll(key).length !== 1) throw new Error("duplicate_parameter");
    return Object.fromEntries(p);
  };
  app.get("/api/oauth/codex/metadata", (c) =>
    c.json({
      issuer: api,
      authorization_endpoint: options.webOrigin + "/app/oauth/codex",
      token_endpoint: api + "/api/oauth/codex/token",
      revocation_endpoint: api + "/api/oauth/codex/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["cadre:read", "cadre:execute"],
    }),
  );
  app.get("/api/oauth/codex/consent", async (c) => {
    try {
      const p = parse(new URL(c.req.url).search.slice(1));
      if (!service) return json({ error: "temporarily_unavailable" }, 503);
      if (!validRequest(p, resource)) return json({ error: "invalid_request" }, 400);
      const session = await options.session(c.req.raw.headers);
      if (!session) return json({ error: "login_required" }, 401);
      return json({
        userId: session.user.id,
        name: session.user.name,
        execute: p.scope.includes("cadre:execute"),
      });
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
  });
  app.post("/api/oauth/codex/consent", async (c) => {
    try {
      if (!service) return json({ error: "temporarily_unavailable" }, 503);
      if (![options.webOrigin, new URL(api).origin].includes(c.req.header("origin") ?? ""))
        return json({ error: "untrusted_origin" }, 403);
      const raw = await readBoundedBody(c.req.raw, 16384);
      if (raw === null) return json({ error: "invalid_request" }, 413);
      const p = parse(raw);
      if (!validRequest(p, resource)) return json({ error: "invalid_request" }, 400);
      const session = await options.session(c.req.raw.headers);
      if (!session || session.user.id !== p.expected_user_id)
        return json({ error: "account_changed" }, 401);
      if (p.decision === "deny") {
        const redirect = new URL(p.redirect_uri);
        redirect.searchParams.set("error", "access_denied");
        redirect.searchParams.set("state", p.state);
        return json({ redirect: redirect.toString() });
      }
      if (p.decision !== "allow") return json({ error: "invalid_request" }, 400);
      return json({ redirect: await service.approve(session.user.id, p) });
    } catch {
      return json({ error: "consent_unavailable" }, 400);
    }
  });
  for (const operation of ["token", "revoke"] as const)
    app.post("/api/oauth/codex/" + operation, async (c) => {
      try {
        if (!service) return json({ error: "temporarily_unavailable" }, 503);
        if (c.req.header("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded")
          return json({ error: "invalid_request" }, 400);
        const raw = await readBoundedBody(c.req.raw, 16384);
        if (raw === null) return json({ error: "invalid_request" }, 413);
        const p = parse(raw);
        if (p.client_id !== CODEX_CLIENT) return json({ error: "invalid_client" }, 400);
        if (operation === "revoke") {
          if (!p.token) return json({ error: "invalid_request" }, 400);
          await service.revoke(p.token);
          return json({});
        }
        if (p.resource !== resource) return json({ error: "invalid_target" }, 400);
        const tokens = await service.exchange(p);
        return tokens ? json(tokens) : json({ error: "invalid_grant" }, 400);
      } catch {
        return json({ error: "temporarily_unavailable" }, 503);
      }
    });
  return service;
}
