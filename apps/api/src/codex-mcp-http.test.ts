import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { mountCodexMcp } from "./codex-mcp-http.js";

const service = { authenticate: vi.fn(), approve: vi.fn(), exchange: vi.fn(), revoke: vi.fn() };
let app: Hono;
beforeEach(() => {
  vi.resetAllMocks();
  service.authenticate.mockResolvedValue({ scope: "cadre:read", userId: "u1" });
  app = new Hono();
  mountCodexMcp(app, service, "https://api.cadre.test");
});
const post = (method: string, params?: unknown) =>
  app.request("/rpc/mcp", {
    method: "POST",
    headers: { authorization: "Bearer cdr_at_fixture" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
it("challenges a revoked credential before listing tools", async () => {
  service.authenticate.mockResolvedValue(null);
  const r = await post("tools/list");
  expect(r.status).toBe(401);
  expect(r.headers.get("www-authenticate")).toContain("/oauth-protected-resource/rpc/mcp");
});
it("does not list or dispatch mutations under a read grant", async () => {
  const b = await (await post("tools/list")).json();
  expect(b.result.tools.some((t: { name: string }) => t.name === "cadre_list_spaces")).toBe(true);
  expect(b.result.tools.some((t: { name: string }) => t.name === "cadre_send_task")).toBe(false);
  expect(
    (
      await (
        await post("tools/call", { name: "cadre_send_task", arguments: { message: "x" } })
      ).json()
    ).error.code,
  ).toBe(-32602);
});
it("reuses product RPC and forwards explicit space for its membership check", async () => {
  app.post("/rpc/me", async (c) =>
    c.json({
      json: {
        spaceId: c.req.header("x-cadre-space-id"),
        body: await c.req.json(),
        authorizationPresent: c.req.header("authorization") === "Bearer cdr_at_fixture",
      },
    }),
  );
  const b = await (
    await post("tools/call", { name: "cadre_me", arguments: { spaceId: "s2" } })
  ).json();
  expect(JSON.parse(b.result.content[0].text)).toEqual({
    spaceId: "s2",
    body: { json: {} },
    authorizationPresent: true,
  });
});
it("does not swallow product membership denials", async () => {
  app.post("/rpc/me", (c) => c.json({ error: "not a member" }, 403));
  const b = await (
    await post("tools/call", { name: "cadre_me", arguments: { spaceId: "forbidden" } })
  ).json();
  expect(b.result.isError).toBe(true);
});
it("rejects extra arguments and unreviewed capabilities", async () => {
  for (const params of [
    { name: "cadre_me", arguments: { organizationId: "other" } },
    { name: "arbitrary_shell", arguments: {} },
  ])
    expect((await (await post("tools/call", params)).json()).error.code).toBe(-32602);
});
