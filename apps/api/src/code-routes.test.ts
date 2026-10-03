import { CodeGatewayError, type CodeModelGateway } from "@cadre/adapters";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createCodeRateLimiter, mountCodeRoutes } from "./code-routes.js";

const actor = { userId: "u1", spaceId: "sp1", email: "a@example.com", isDeploymentOwner: false };

function setup(options: { stream?: CodeModelGateway["stream"]; max?: number } = {}) {
  const usage: unknown[] = [];
  const calls: unknown[] = [];
  const gateway = {
    listModels: async () => [{ provider: "faux", id: "m", name: "M" }],
    stream:
      options.stream ??
      async function* (request) {
        calls.push(request);
        yield JSON.stringify({ type: "start" });
        await request.onUsage?.({ provider: "faux", model: "m", inputTokens: 3, outputTokens: 2 });
        yield JSON.stringify({ type: "done" });
      },
  } as unknown as CodeModelGateway;
  const app = new Hono();
  mountCodeRoutes(app, {
    gateway,
    authenticate: async (c) => (c.req.header("x-user") ? actor : null),
    recordUsage: async (_actor, record) => void usage.push(record),
    rateLimit: { max: options.max ?? 100, windowMs: 60_000 },
  });
  return { app, usage, calls };
}

const post = (app: Hono, body: unknown, headers: Record<string, string> = { "x-user": "u1" }) =>
  app.request("/api/code/model-stream", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = { provider: "faux", model: "m", context: { messages: [] }, options: {} };

describe("code model gateway routes", () => {
  it("requires authentication", async () => {
    const { app } = setup();
    expect((await post(app, valid, {})).status).toBe(401);
    expect((await app.request("/api/code/models")).status).toBe(401);
  });

  it("lists models for the user", async () => {
    const { app } = setup();
    const response = await app.request("/api/code/models", { headers: { "x-user": "u1" } });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { models: unknown[] }).models).toHaveLength(1);
  });

  it("frames events as SSE and ends with [DONE], recording usage", async () => {
    const { app, usage } = setup();
    const response = await post(app, valid);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe(
      'data: {"type":"start"}\n\ndata: {"type":"done"}\n\ndata: [DONE]\n\n',
    );
    expect(usage).toEqual([{ provider: "faux", model: "m", inputTokens: 3, outputTokens: 2 }]);
  });

  it("validates the body", async () => {
    const { app } = setup();
    expect((await post(app, "{")).status).toBe(400);
    expect((await post(app, { provider: "faux" })).status).toBe(400);
    expect((await post(app, { ...valid, context: {} })).status).toBe(400);
  });

  it("maps gateway setup errors to status codes", async () => {
    const { app } = setup({
      // biome-ignore lint/correctness/useYield: fails before the first event
      stream: async function* () {
        throw new CodeGatewayError("No connected model for faux", 404);
      },
    });
    const response = await post(app, valid);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No connected model for faux" });
  });

  it("rate limits per user", async () => {
    const { app } = setup({ max: 1 });
    expect((await (await post(app, valid)).text()).length).toBeGreaterThan(0);
    expect((await post(app, valid)).status).toBe(429);
  });

  it("limiter frees concurrency slots", () => {
    const limiter = createCodeRateLimiter({ max: 10, windowMs: 1000, maxConcurrent: 1 });
    const release = limiter.acquire("u");
    expect(limiter.acquire("u")).toBeNull();
    expect(limiter.acquire("other")).not.toBeNull();
    release?.();
    expect(limiter.acquire("u")).not.toBeNull();
  });
});
