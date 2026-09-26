import type { createOperateWork } from "@cadre/adapters";
import type { Actor } from "@cadre/contracts";
import type { Context, Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

const KNOWN_REFUSALS = new Set([
  "Bot not found",
  "Finish or cancel the task in progress before changing the bot",
]);

/** Which bot works the member's Operate tasks, and what it is working on. */
export function mountOperateWorkRoutes(
  app: Hono,
  operateWork: ReturnType<typeof createOperateWork>,
  authenticate: (c: Context) => Promise<Actor | null>,
  webOrigin: string,
) {
  const sameOrigin = (c: Context) => c.req.header("origin") === new URL(webOrigin).origin;

  app.get("/api/v1/operate-work", async (c) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ worker: await operateWork.status(actor) });
  });

  app.put("/api/v1/operate-work", async (c) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "Invalid origin" }, 403);
    const raw = await readBoundedBody(c.req.raw, 1024);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    let body: { botId?: unknown; enabled?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid request" }, 400);
    }
    if (body?.botId !== null && typeof body?.botId !== "string")
      return c.json({ error: "botId must be a string or null" }, 400);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean")
      return c.json({ error: "enabled must be a boolean" }, 400);
    try {
      const worker = await operateWork.configure(actor, {
        botId: body.botId,
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      });
      return c.json({ worker });
    } catch (error) {
      // Only the loop's own refusals are shown; anything else stays generic.
      const message = error instanceof Error ? error.message : "";
      return c.json({ error: KNOWN_REFUSALS.has(message) ? message : "Could not save" }, 400);
    }
  });

  app.post("/api/v1/operate-work/assignments/:id/cancel", async (c) => {
    const actor = await authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401);
    if (!sameOrigin(c)) return c.json({ error: "Invalid origin" }, 403);
    await operateWork.cancel(actor, c.req.param("id"));
    return c.json({ worker: await operateWork.status(actor) });
  });
}
