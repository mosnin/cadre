import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type Models,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  CodeGatewayError,
  createCodeModelGateway,
  parseCodeContext,
  sanitizeCodeStreamOptions,
} from "./code-model-gateway.js";

const KEY = "sk-test-secret-key-123456";

function setup(options: { secret?: string | null; deploymentModelKey?: string } = {}) {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1", reasoning: true }] });
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const secret = options.secret === undefined ? KEY : options.secret;
  const prisma = {
    userModelCredential: {
      findFirst: async ({ where }: { where: { userId: string; provider: string } }) =>
        secret !== null && where.userId === "u1" && where.provider === "faux"
          ? { id: "c1", userId: "u1", provider: "faux", secretId: "s1" }
          : null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        secret !== null && where.userId === "u1"
          ? [{ id: "c1", provider: "faux", preferences: [] }]
          : [],
    },
    secret: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === "s1" && where.userId === "u1" ? { id: "s1", ciphertext: "enc" } : null,
    },
  };
  const gateway = createCodeModelGateway({
    prisma: prisma as never,
    secretStore: { load: () => secret ?? "" } as never,
    deploymentModelKey: options.deploymentModelKey,
    catalog: () => catalog as Models,
  });
  return { faux, gateway };
}

const context = { messages: [{ role: "user", content: "hi", timestamp: 1 }] } as never;
const actor = { userId: "u1", spaceId: "sp1" };

async function collect(iterable: AsyncIterable<string>) {
  const out: Record<string, unknown>[] = [];
  for await (const frame of iterable) out.push(JSON.parse(frame));
  return out;
}

describe("code model gateway", () => {
  it("streams events with the user's key and reports usage", async () => {
    const { faux, gateway } = setup();
    let seenKey: string | undefined;
    faux.setResponses([
      (_ctx, options) => {
        seenKey = options?.apiKey;
        return fauxAssistantMessage("hello there");
      },
    ]);
    const usage: unknown[] = [];
    const events = await collect(
      gateway.stream({
        actor,
        provider: "faux",
        model: "faux-1",
        context,
        onUsage: (u) => void usage.push(u),
      }),
    );
    expect(seenKey).toBe(KEY);
    expect(events[0]?.type).toBe("start");
    expect(events.at(-1)?.type).toBe("done");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "faux", model: "faux-1" });
  });

  it("never echoes credentials", async () => {
    const { faux, gateway } = setup();
    faux.setResponses([(_c, options) => fauxAssistantMessage(`key is ${options?.apiKey}`)]);
    const frames: string[] = [];
    for await (const frame of gateway.stream({ actor, provider: "faux", model: "faux-1", context }))
      frames.push(frame);
    expect(frames.join("")).not.toContain(KEY);
    expect(frames.join("")).toContain("[redacted]");
  });

  it("rejects providers the user has not connected", async () => {
    const { gateway } = setup({ secret: null });
    await expect(
      collect(gateway.stream({ actor, provider: "faux", model: "faux-1", context })),
    ).rejects.toMatchObject({ name: "CodeGatewayError", status: 404 });
  });

  it("rejects unknown models", async () => {
    const { gateway } = setup();
    await expect(
      collect(gateway.stream({ actor, provider: "faux", model: "nope", context })),
    ).rejects.toBeInstanceOf(CodeGatewayError);
  });

  it("does not use another user's credential", async () => {
    const { gateway } = setup();
    await expect(
      collect(
        gateway.stream({
          actor: { userId: "u2", spaceId: "sp1" },
          provider: "faux",
          model: "faux-1",
          context,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("aborts the model call when the client disconnects", async () => {
    const { faux, gateway } = setup();
    faux.setResponses([fauxAssistantMessage("a long answer ".repeat(200))]);
    const controller = new AbortController();
    const frames: string[] = [];
    for await (const frame of gateway.stream({
      actor,
      provider: "faux",
      model: "faux-1",
      context,
      signal: controller.signal,
    })) {
      frames.push(frame);
      controller.abort();
    }
    expect(JSON.parse(frames.at(-1) as string).type).toBe("error");
  });

  it("lists models for connected providers", async () => {
    const { gateway } = setup();
    expect(await gateway.listModels("u1")).toEqual([
      expect.objectContaining({ provider: "faux", id: "faux-1", reasoning: true }),
    ]);
    expect(await gateway.listModels("u2")).toEqual([]);
  });

  it("keeps only generation options", () => {
    expect(
      sanitizeCodeStreamOptions({
        apiKey: "stolen",
        headers: { authorization: "x" },
        env: { A: "b" },
        baseUrl: "http://evil",
        temperature: 0.2,
        maxTokens: 100,
        reasoning: "high",
        toolChoice: "none",
      }),
    ).toEqual({ temperature: 0.2, maxTokens: 100, reasoning: "high", toolChoice: "none" });
  });

  it("validates the context shape", () => {
    expect(() => parseCodeContext({})).toThrow(CodeGatewayError);
    expect(() => parseCodeContext({ messages: [], tools: "x" })).toThrow(CodeGatewayError);
    expect(parseCodeContext({ messages: [] })).toEqual({ messages: [] });
  });
});
