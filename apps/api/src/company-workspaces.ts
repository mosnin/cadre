import type { CompanyWorkspaces } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { Context, Hono } from "hono";

export function mountCompanyWorkspaceRoutes(
  app: Hono,
  service: CompanyWorkspaces | undefined,
  authenticate: (c: Context) => Promise<{ actor: Actor; sessionId: string } | null>,
  webOrigin: string,
) {
  app.get("/api/v1/company-workspaces", async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    c.header("Cache-Control", "no-store");
    return c.json({
      available: Boolean(service),
      connections: service ? await service.list(auth.actor.userId) : [],
    });
  });
  app.post("/api/v1/company-workspaces/connect", async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (c.req.header("origin") !== new URL(webOrigin).origin)
      return c.json({ error: "Invalid origin" }, 403);
    if (!service) return c.json({ error: "Company OS connection is not configured" }, 503);
    try {
      return c.json({ url: await service.start(auth.actor, auth.sessionId) });
    } catch {
      return c.json({ error: "Could not start Company OS connection" }, 400);
    }
  });
  app.post("/api/v1/company-workspaces/disconnect", async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    if (c.req.header("origin") !== new URL(webOrigin).origin)
      return c.json({ error: "Invalid origin" }, 403);
    if (!service) return c.json({ error: "Company OS connection is not configured" }, 503);
    await service.disconnect(auth.actor);
    return c.json({ disconnected: true });
  });
  app.get("/api/v1/company-workspaces/callback", async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.redirect(new URL("/login", webOrigin).href);
    try {
      if (!service) throw new Error("Unavailable");
      const spaceId = await service.finish(
        auth.actor.userId,
        auth.sessionId,
        new URL(c.req.url).searchParams,
      );
      return c.redirect(
        new URL(`/app?company-connected=${encodeURIComponent(spaceId)}`, webOrigin).href,
      );
    } catch {
      return c.redirect(new URL("/app?company-error=1", webOrigin).href);
    }
  });
}
