import { afterEach, expect, it, vi } from "vitest";
import gateway from "../../../infra/cloudflare/worker.js";
import { addScreenProxyCapability } from "./screen-proxy.js";

afterEach(() => vi.unstubAllGlobals());
it("serves viewer modules to opaque frames without forwarding application credentials", async () => {
  const secret = "test-screen-secret-at-least-32-characters";
  const url = addScreenProxyCapability(
    "https://computer.modal.host/embed.html?cadre_token=view&view_only=true",
    secret,
    "https://screen.example",
    undefined,
    { proxyExternal: true },
  );
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("export default 1", {
        headers: { "content-type": "text/javascript", "set-cookie": "untrusted=yes" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const response = await gateway.fetch(
    new Request(url.replace("/embed.html", "/core/rfb.js"), {
      headers: { origin: "null", cookie: "app=session", authorization: "Bearer app-secret" },
    }),
    { SCREEN_PROXY_SECRET: secret, STORAGE_GATEWAY_TOKEN: secret, ARTIFACTS: {} as never },
  );
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("set-cookie")).toBeNull();
  const headers = fetcher.mock.calls[0]?.[1]?.headers as Headers;
  expect(headers.has("cookie")).toBe(false);
  expect(headers.has("authorization")).toBe(false);
  const denied = await gateway.fetch(
    new Request("https://screen.example/novnc/remote/view/0.invalid/core/rfb.js"),
    { SCREEN_PROXY_SECRET: secret, STORAGE_GATEWAY_TOKEN: secret, ARTIFACTS: {} as never },
  );
  expect(denied.status).toBe(403);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("restricts Fly screens to the exact configured application", async () => {
  const secret = "test-screen-secret-at-least-32-characters";
  const fetcher = vi.fn(async () => new Response("viewer"));
  vi.stubGlobal("fetch", fetcher);
  const env = { SCREEN_PROXY_SECRET: secret, STORAGE_GATEWAY_TOKEN: secret, FLY_COMPUTER_APP: "test-team-computers", ARTIFACTS: {} as never };
  for (const [host, expected] of [["test-team-computers.fly.dev", 200], ["cadre-computers.fly.dev", 403], ["evil-test-team-computers.fly.dev", 403]] as const) {
    const url = addScreenProxyCapability(`https://${host}/embed.html`, secret, "https://screen.example", undefined, { proxyExternal: true });
    expect((await gateway.fetch(new Request(url), env)).status).toBe(expected);
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
});
