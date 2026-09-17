import { WORKSPACE_PROVIDERS, type WorkspaceIntegrations } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import type { Context, Hono } from "hono";

export function mountWorkspaceIntegrationRoutes(
  app: Hono,
  service: WorkspaceIntegrations | undefined,
  authenticate: (c: Context) => Promise<{ actor: Actor; sessionId: string } | null>,
  webOrigin: string,
) {
  app.get("/api/v1/workspace-integrations", async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: "Unauthorized" }, 401);
    c.header("Cache-Control", "no-store");
    return c.json({
      available: Boolean(service),
      providers: WORKSPACE_PROVIDERS.map((id) => {
        const config = service?.provider(id);
        return {
          id,
          name: config?.name ?? id,
          workspaceNoun: config?.workspaceNoun ?? "workspace",
        };
      }),
      connections: service ? await service.list(auth.actor) : [],
    });
  });
  for (const provider of WORKSPACE_PROVIDERS) {
    const path = `/api/v1/workspace-integrations/${provider}`;
    app.post(`${path}/connect`, async (c) => {
      const auth = await authenticate(c);
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      if (!trustedClientOrigin(c.req.header("origin"), webOrigin))
        return c.json({ error: "Invalid origin" }, 403);
      if (!service) return c.json({ error: "Connection unavailable" }, 503);
      try {
        return c.json({ url: await service.start(provider, auth.actor, auth.sessionId) });
      } catch {
        return c.json({ error: "Could not start connection. Try again." }, 400);
      }
    });
    app.post(`${path}/disconnect`, async (c) => {
      const auth = await authenticate(c);
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      if (!trustedClientOrigin(c.req.header("origin"), webOrigin))
        return c.json({ error: "Invalid origin" }, 403);
      if (!service) return c.json({ error: "Connection unavailable" }, 503);
      await service.disconnect(provider, auth.actor);
      return c.json({ disconnected: true });
    });
    app.get(`${path}/callback`, async (c) => {
      const auth = await authenticate(c);
      if (!auth) return c.redirect(new URL("/login", webOrigin).href);
      try {
        if (!service) throw new Error("Unavailable");
        const spaceId = await service.finish(
          provider,
          auth.actor.userId,
          auth.sessionId,
          new URL(c.req.url).searchParams,
        );
        return c.redirect(
          new URL(
            `/app?integration=${provider}&connected=${encodeURIComponent(spaceId)}`,
            webOrigin,
          ).href,
        );
      } catch {
        return c.redirect(
          new URL(`/app?integration=${provider}&connection-error=1`, webOrigin).href,
        );
      }
    });
  }
}

/** Browser sessions must come from the web app; the native apps identify themselves by scheme. */
function trustedClientOrigin(origin: string | undefined, webOrigin: string): boolean {
  if (!origin) return false;
  if (origin === new URL(webOrigin).origin) return true;
  return origin.startsWith("rakazo://") || origin.startsWith("exp://");
}
