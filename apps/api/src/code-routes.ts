import {
  CODE_GATEWAY_MAX_BODY_BYTES,
  CodeGatewayError,
  type CodeModelGateway,
  parseCodeContext,
} from "@cadre/adapters";
import type { Actor } from "@cadre/contracts";
import type { Context, Hono } from "hono";
import { readBoundedBody } from "./http-body.js";

export interface CodeRouteDeps {
  gateway: CodeModelGateway;
  /** Trusted-origin check plus session (bearer or cookie). Null means unauthorized. */
  authenticate(c: Context): Promise<Actor | null>;
  recordUsage(
    actor: Actor,
    usage: { provider: string; model: string; inputTokens: number; outputTokens: number },
  ): Promise<void>;
  /** Requests per user per window. Defaults to 240 per minute. */
  rateLimit?: { max: number; windowMs: number };
  maxConcurrent?: number;
  now?: () => number;
}

/** Per-user sliding window plus a cap on concurrent streams. */
export function createCodeRateLimiter(options: {
  max: number;
  windowMs: number;
  maxConcurrent: number;
  now?: () => number;
}) {
  const hits = new Map<string, number[]>();
  const active = new Map<string, number>();
  const now = options.now ?? Date.now;
  return {
    /** Returns a release function, or null when the user is over a limit. */
    acquire(userId: string): (() => void) | null {
      const at = now();
      const recent = (hits.get(userId) ?? []).filter((t) => at - t < options.windowMs);
      if (recent.length >= options.max || (active.get(userId) ?? 0) >= options.maxConcurrent) {
        hits.set(userId, recent);
        return null;
      }
      recent.push(at);
      hits.set(userId, recent);
      active.set(userId, (active.get(userId) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (active.get(userId) ?? 1) - 1;
        if (left <= 0) active.delete(userId);
        else active.set(userId, left);
      };
    },
  };
}

/** `/api/code/*`: the model gateway for Cadre Code in the Burst desktop app. */
export function mountCodeRoutes(app: Hono, deps: CodeRouteDeps) {
  const limiter = createCodeRateLimiter({
    max: deps.rateLimit?.max ?? 240,
    windowMs: deps.rateLimit?.windowMs ?? 60_000,
    maxConcurrent: deps.maxConcurrent ?? 8,
    now: deps.now,
  });
  const noStore = { "cache-control": "no-store" };

  app.get("/api/code/models", async (c) => {
    const actor = await deps.authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401, noStore);
    const models = await deps.gateway.listModels(actor.userId);
    return c.json({ models }, 200, noStore);
  });

  app.post("/api/code/model-stream", async (c) => {
    const actor = await deps.authenticate(c);
    if (!actor) return c.json({ error: "Unauthorized" }, 401, noStore);
    const release = limiter.acquire(actor.userId);
    if (!release)
      return c.json({ error: "Too many requests" }, 429, { ...noStore, "retry-after": "5" });
    try {
      const text = await readBoundedBody(c.req.raw, CODE_GATEWAY_MAX_BODY_BYTES);
      if (text === null) {
        release();
        return c.json({ error: "Request too large" }, 413, noStore);
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
      } catch {
        release();
        return c.json({ error: "Invalid JSON" }, 400, noStore);
      }
      if (typeof body.provider !== "string" || typeof body.model !== "string") {
        release();
        return c.json({ error: "provider and model are required" }, 400, noStore);
      }
      let context: ReturnType<typeof parseCodeContext>;
      try {
        context = parseCodeContext(body.context);
      } catch (error) {
        release();
        return c.json({ error: (error as Error).message }, 400, noStore);
      }

      const abort = new AbortController();
      const onClientAbort = () => abort.abort();
      if (c.req.raw.signal.aborted) abort.abort();
      else c.req.raw.signal.addEventListener("abort", onClientAbort, { once: true });
      const frames = deps.gateway.stream({
        actor,
        provider: body.provider,
        model: body.model,
        context,
        options: body.options,
        signal: abort.signal,
        onUsage: (usage) => deps.recordUsage(actor, usage).catch(() => undefined),
      });
      const iterator = frames[Symbol.asyncIterator]();
      // Resolve the first frame before answering so setup errors (unknown model, no
      // connection, refresh failure) become a real status code instead of a 200 stream.
      let first: IteratorResult<string>;
      try {
        first = await iterator.next();
      } catch (error) {
        c.req.raw.signal.removeEventListener("abort", onClientAbort);
        release();
        if (error instanceof CodeGatewayError)
          return c.json({ error: error.message }, error.status, noStore);
        return c.json({ error: "Model request failed" }, 502, noStore);
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (text: string) => {
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              abort.abort();
            }
          };
          try {
            let step = first;
            while (!step.done) {
              send(`data: ${step.value}\n\n`);
              step = await iterator.next();
            }
          } catch (error) {
            if (!abort.signal.aborted) {
              const message =
                error instanceof CodeGatewayError ? error.message : "Model request failed";
              send(
                `data: ${JSON.stringify({ type: "error", reason: "error", error: { role: "assistant", content: [], stopReason: "error", errorMessage: message } })}\n\n`,
              );
            }
          } finally {
            c.req.raw.signal.removeEventListener("abort", onClientAbort);
            release();
            send("data: [DONE]\n\n");
            try {
              controller.close();
            } catch {
              // Client already disconnected.
            }
          }
        },
        cancel() {
          abort.abort();
          void iterator.return?.(undefined);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-store, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    } catch (error) {
      release();
      throw error;
    }
  });
}
