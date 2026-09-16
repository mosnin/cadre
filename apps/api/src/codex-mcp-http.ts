import { allowsRoute, type createCodexOAuth } from "@rakazo/auth/codex-oauth";
import { codexMcpTools } from "@rakazo/contracts";
import type { Hono } from "hono";
import { z } from "zod";
import { readBoundedBody } from "./http-body.js";

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .optional(),
});
export function mountCodexMcp(
  app: Hono,
  service: ReturnType<typeof createCodexOAuth> | null,
  apiUrl: string,
) {
  const api = apiUrl.replace(/\/$/, "");
  const metadata = `${api}/.well-known/oauth-protected-resource/rpc/mcp`;
  app.get("/.well-known/oauth-protected-resource/rpc/mcp", (c) =>
    c.json({
      // RFC 9728 requires this to equal the protected resource the client reached.
      resource: `${api}/rpc/mcp`,
      authorization_servers: [`${api}/codex`],
      scopes_supported: ["cadre:read", "cadre:execute"],
      bearer_methods_supported: ["header"],
    }),
  );
  const failure = (id: unknown, code: number, message: string, status = 200) =>
    Response.json(
      { jsonrpc: "2.0", id, error: { code, message } },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 401
            ? { "WWW-Authenticate": `Bearer resource_metadata="${metadata}"` }
            : {}),
        },
      },
    );
  const result = (id: unknown, value: unknown) =>
    Response.json(
      { jsonrpc: "2.0", id, result: value },
      { headers: { "Cache-Control": "no-store" } },
    );
  app.post("/rpc/mcp", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer (cdr_at_[A-Za-z0-9_-]+)$/i)?.[1];
    const grant = token ? await service?.authenticate(token, "/rpc/me") : null;
    if (!grant) return failure(null, -32001, "Sign in to Cadre.", 401);
    const raw = await readBoundedBody(c.req.raw, 65536);
    if (raw === null) return failure(null, -32600, "Request too large", 413);
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return failure(null, -32700, "Invalid JSON", 400);
    }
    const parsed = requestSchema.safeParse(decoded);
    if (!parsed.success) return failure(null, -32600, "Invalid request", 400);
    const body = parsed.data;
    const id = body.id ?? null;
    if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
    if (body.method === "initialize")
      return result(id, {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "cadre", version: "1.0.0" },
        instructions:
          "Discover spaces first. Select an accessible space for each operation. Task acceptance is not task completion; preserve clientNonce when recovering an uncertain send.",
      });
    if (body.method === "ping") return result(id, {});
    const available = codexMcpTools.filter((t) => allowsRoute(grant.scope, `/rpc/${t.route}`));
    if (body.method === "tools/list")
      return result(id, {
        tools: available.map(({ route: _route, method: _method, ...tool }) => tool),
      });
    if (body.method !== "tools/call") return failure(id, -32601, "Method not found");
    const tool = available.find((t) => t.name === body.params?.name);
    if (!tool) return failure(id, -32602, "Tool unavailable under this grant");
    const args = body.params?.arguments ?? {};
    if (
      !args ||
      typeof args !== "object" ||
      Array.isArray(args) ||
      Object.keys(args).some((k) => !Object.hasOwn(tool.inputSchema.properties, k))
    )
      return failure(id, -32602, "Invalid arguments");
    const { spaceId, ...input } = args;
    if (spaceId !== undefined && (typeof spaceId !== "string" || !spaceId || spaceId.length > 200))
      return failure(id, -32602, "Invalid space");
    const response = await app.request(`${api}/rpc/${tool.route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(spaceId ? { "x-rakazo-space-id": spaceId } : {}),
      },
      body: JSON.stringify({ json: input }),
      signal: c.req.raw.signal,
    });
    if (response.status === 401) return failure(id, -32001, "Sign in to Cadre.", 401);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result(id, {
        content: [
          { type: "text", text: `Cadre returned an unreadable response (${response.status}).` },
        ],
        isError: true,
      });
    }
    return result(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            payload && typeof payload === "object" && "json" in payload ? payload.json : payload,
          ),
        },
      ],
      ...(!response.ok ? { isError: true } : {}),
    });
  });
  app.get("/rpc/mcp", () => new Response(null, { status: 405 }));
  app.delete("/rpc/mcp", () => new Response(null, { status: 204 }));
}
