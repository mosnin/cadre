import { describe, expect, it } from "vitest";
import { addScreenProxyCapability } from "./screen-proxy.js";

describe("screen proxy capability", () => {
  it("signs loopback Docker screen URLs without changing their destination", () => {
    const result = new URL(
      addScreenProxyCapability(
        "http://127.0.0.1:49152/embed.html?view_only=true",
        "secret",
        "https://app.example",
        100,
      ),
    );
    expect(result.origin).toBe("https://app.example");
    expect(result.pathname).toMatch(
      /^\/novnc\/[\w-]+\/49152\/view\/3600100\.[\w-]{43}\/embed\.html$/,
    );
    expect(result.searchParams.get("view_only")).toBe("true");
  });

  it("does not modify managed-provider URLs", () => {
    const url = "https://sandbox.example/embed.html?token=provider-token";
    expect(addScreenProxyCapability(url, "secret", "https://app.example", 100)).toBe(url);
  });

  it("keeps external desktop secrets behind an encrypted, policy-bound capability", () => {
    const result = new URL(
      addScreenProxyCapability(
        "https://box.example/vnc.html?token=provider-token&view_only=true",
        "secret",
        "https://app.example",
        100,
        { proxyExternal: true },
      ),
    );
    expect(result.origin).toBe("https://app.example");
    expect(result.pathname).toMatch(/^\/novnc\/remote\/view\/3600100\.[\w-]+\/vnc\.html$/);
    expect(result.toString()).not.toContain("provider-token");
  });
});

it("retains a stable viewer capability until renewal, and separates control grants", () => {
  const args = [
    "https://computer.example/embed.html?cadre_token=view&view_only=true",
    "cache-secret",
    "https://viewer.example",
  ] as const;
  const first = addScreenProxyCapability(...args, 1000, { proxyExternal: true });
  expect(addScreenProxyCapability(...args, 2000, { proxyExternal: true })).toBe(first);
  expect(addScreenProxyCapability(...args, 56 * 60_000, { proxyExternal: true })).not.toBe(first);
  expect(
    addScreenProxyCapability(
      args[0].replace("view_only=true", "view_only=false"),
      args[1],
      args[2],
      2000,
      { proxyExternal: true },
    ),
  ).not.toBe(first);
  expect(
    addScreenProxyCapability(
      args[0].replace("cadre_token=view", "cadre_token=other"),
      args[1],
      args[2],
      2000,
      { proxyExternal: true },
    ),
  ).not.toBe(first);
});
