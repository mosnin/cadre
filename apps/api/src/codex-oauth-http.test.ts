import { CODEX_CLIENT, createCodexOAuth } from "@rakazo/auth/codex-oauth";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { mountCodexOAuth } from "./codex-oauth-http.js";

vi.mock("@rakazo/auth/codex-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@rakazo/auth/codex-oauth")>()),
  createCodexOAuth: vi.fn(),
}));
const api = "https://api.cadre.test",
  web = "https://app.cadre.test";
const p = {
  client_id: CODEX_CLIENT,
  response_type: "code",
  redirect_uri: "http://127.0.0.1:49152/oauth/callback",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  scope: "cadre:read",
  resource: api + "/rpc",
  state: "fixture-state",
};
let app: Hono;
const service = { approve: vi.fn(), exchange: vi.fn(), authenticate: vi.fn(), revoke: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createCodexOAuth).mockReturnValue(service);
  app = new Hono();
  mountCodexOAuth(app, {
    pool: {} as never,
    apiUrl: api,
    webOrigin: web,
    session: async () => ({ user: { id: "actor", name: "Fixture" } }),
  });
});
const post = (path: string, body: Record<string, string>, origin = web) =>
  app.request(path, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
it("checks CSRF origin and the exact account shown before consent", async () => {
  expect(
    (
      await post(
        "/api/oauth/codex/consent",
        { ...p, expected_user_id: "actor", decision: "allow" },
        "https://attacker.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await post("/api/oauth/codex/consent", { ...p, expected_user_id: "other", decision: "allow" }))
      .status,
  ).toBe(401);
  expect(service.approve).not.toHaveBeenCalled();
  service.approve.mockResolvedValue(p.redirect_uri + "?code=fixture");
  expect(
    (await post("/api/oauth/codex/consent", { ...p, expected_user_id: "actor", decision: "allow" }))
      .status,
  ).toBe(200);
  expect(service.approve).toHaveBeenCalledWith(
    "actor",
    expect.objectContaining({ scope: "cadre:read" }),
  );
});
it("rejects wrong resource before token exchange and never caches tokens", async () => {
  expect(
    (
      await post("/api/oauth/codex/token", {
        client_id: CODEX_CLIENT,
        resource: "https://other.test",
      })
    ).status,
  ).toBe(400);
  expect(service.exchange).not.toHaveBeenCalled();
  service.exchange.mockResolvedValue({ access_token: "fixture" });
  const response = await post("/api/oauth/codex/token", {
    client_id: CODEX_CLIENT,
    resource: api + "/rpc",
    grant_type: "authorization_code",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("cancel returns the original state without issuing a code", async () => {
  const response = await post("/api/oauth/codex/consent", {
    ...p,
    expected_user_id: "actor",
    decision: "deny",
  });
  const redirect = new URL((await response.json()).redirect);
  expect(redirect.searchParams.get("state")).toBe(p.state);
  expect(redirect.searchParams.get("error")).toBe("access_denied");
  expect(service.approve).not.toHaveBeenCalled();
});
it("rejects duplicate and oversized parameters", async () => {
  const response = await app.request("/api/oauth/codex/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "client_id=a&client_id=b",
  });
  expect(response.status).toBe(503);
  expect(service.exchange).not.toHaveBeenCalled();
  expect((await post("/api/oauth/codex/token", { padding: "x".repeat(17000) })).status).toBe(413);
});
