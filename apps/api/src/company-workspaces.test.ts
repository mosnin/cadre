import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { mountCompanyWorkspaceRoutes } from "./company-workspaces.js";

describe("Company workspace HTTP boundary", () => {
  const origin = "https://cadre.example";
  function fixture(signedIn = true, configured = true) {
    const service = {
      list: vi.fn().mockResolvedValue([]),
      start: vi.fn().mockResolvedValue("https://company.example/oauth/authorize"),
      finish: vi.fn().mockResolvedValue("workspace-one"),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const app = new Hono();
    mountCompanyWorkspaceRoutes(
      app,
      configured ? (service as never) : undefined,
      async () =>
        signedIn
          ? {
              actor: {
                userId: "user-one",
                spaceId: "workspace-one",
                email: "user@example.test",
                isDeploymentOwner: false,
              },
              sessionId: "session-one",
            }
          : null,
      origin,
    );
    return { app, service };
  }
  it("requires authentication and rejects cross-origin writes", async () => {
    expect((await fixture(false).app.request("/api/v1/company-workspaces")).status).toBe(401);
    const { app, service } = fixture();
    for (const action of ["connect", "disconnect"]) {
      expect(
        (
          await app.request(`/api/v1/company-workspaces/${action}`, {
            method: "POST",
            headers: { origin: "https://other.example" },
          })
        ).status,
      ).toBe(403);
    }
    expect(service.start).not.toHaveBeenCalled();
    expect(service.disconnect).not.toHaveBeenCalled();
  });
  it("starts with the authenticated workspace and session, never request-supplied identity", async () => {
    const { app, service } = fixture();
    const response = await app.request("/api/v1/company-workspaces/connect", {
      method: "POST",
      headers: { origin },
      body: JSON.stringify({ userId: "other", spaceId: "other" }),
    });
    expect(response.status).toBe(200);
    expect(service.start).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-one", spaceId: "workspace-one" }),
      "session-one",
    );
  });
  it("supports an unconfigured deployment without pretending it connected", async () => {
    const { app } = fixture(true, false);
    const response = await app.request("/api/v1/company-workspaces");
    expect(await response.json()).toEqual({ available: false, connections: [] });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      (
        await app.request("/api/v1/company-workspaces/connect", {
          method: "POST",
          headers: { origin },
        })
      ).status,
    ).toBe(503);
  });
  it("returns only fixed local callback destinations without provider error text", async () => {
    const { app, service } = fixture();
    const success = await app.request(
      "/api/v1/company-workspaces/callback?code=test&state=state&iss=https://company.example",
    );
    expect(success.headers.get("location")).toBe(`${origin}/app?company-connected=workspace-one`);
    service.finish.mockRejectedValue(new Error("private provider detail"));
    const failure = await app.request("/api/v1/company-workspaces/callback?error=denied");
    expect(failure.headers.get("location")).toBe(`${origin}/app?company-error=1`);
  });
});
