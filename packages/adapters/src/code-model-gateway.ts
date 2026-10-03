import type { Actor } from "@cadre/contracts";
import type { PrismaClient } from "@cadre/db";
import {
  type AssistantMessageEvent,
  type Context,
  getSupportedThinkingLevels,
  type Model,
  type Models,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolveDeploymentModel } from "./deployment-model.js";
import { type ExecutorDeps, resolveModelKey } from "./executor.js";
import { registerLocalProvider } from "./pi-local-provider.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  registerOpenAiCompatibleCatalog,
} from "./pi-openai-compatible-provider.js";
import { modelsForRequest, reliableStreamOptions } from "./pi-runtime.js";

/**
 * Model gateway for Cadre Code, the coding agent that runs inside the Burst desktop app. The
 * agent loop runs on the device; every model call comes here so it uses the models the user
 * already connected in Cadre and no provider credential ever leaves the server.
 */

export const CODE_GATEWAY_MAX_BODY_BYTES = 32 * 1024 * 1024;

export class CodeGatewayError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
    this.name = "CodeGatewayError";
  }
}

export interface CodeModelInfo {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
  thinkingLevels: string[];
}

export interface CodeGatewayUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CodeModelGatewayDeps {
  prisma: PrismaClient;
  secretStore: ExecutorDeps["secretStore"];
  deploymentModelKey?: string;
  /** Override the catalog (tests). */
  catalog?: () => Models;
}

export interface CodeStreamRequest {
  actor: Pick<Actor, "userId" | "spaceId">;
  provider: string;
  model: string;
  context: Context;
  options?: unknown;
  signal?: AbortSignal;
  onUsage?: (usage: CodeGatewayUsage) => void | Promise<void>;
}

let catalogCache: Models | undefined;
function defaultCatalog(): Models {
  catalogCache ??= registerOpenAiCompatibleCatalog(registerLocalProvider(builtinModels()));
  return catalogCache;
}

/**
 * Only generation parameters cross the gateway. Anything that could redirect a request or carry
 * a credential (apiKey, headers, env, fetch, payload hooks, base URL) is dropped.
 */
export function sanitizeCodeStreamOptions(options: unknown): SimpleStreamOptions {
  const raw = options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const out: SimpleStreamOptions = {};
  if (typeof raw.temperature === "number" && Number.isFinite(raw.temperature))
    out.temperature = Math.min(Math.max(raw.temperature, 0), 2);
  if (typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens) && raw.maxTokens > 0)
    out.maxTokens = Math.floor(raw.maxTokens);
  if (typeof raw.reasoning === "string") {
    const levels = ["minimal", "low", "medium", "high", "xhigh", "max"];
    if (levels.includes(raw.reasoning))
      out.reasoning = raw.reasoning as SimpleStreamOptions["reasoning"];
  }
  if (raw.toolChoice === "auto" || raw.toolChoice === "none") out.toolChoice = raw.toolChoice;
  if (typeof raw.sessionId === "string" && raw.sessionId.length <= 200)
    out.sessionId = raw.sessionId;
  if (
    raw.cacheRetention === "none" ||
    raw.cacheRetention === "short" ||
    raw.cacheRetention === "long"
  )
    out.cacheRetention = raw.cacheRetention;
  return out;
}

/** Validate the wire `Context`: the shape is the library's, the content is the client's. */
export function parseCodeContext(value: unknown): Context {
  if (!value || typeof value !== "object" || !Array.isArray((value as Context).messages))
    throw new CodeGatewayError("context.messages must be an array", 400);
  const context = value as Context;
  if (context.tools !== undefined && !Array.isArray(context.tools))
    throw new CodeGatewayError("context.tools must be an array", 400);
  if (context.systemPrompt !== undefined && typeof context.systemPrompt !== "string")
    throw new CodeGatewayError("context.systemPrompt must be a string", 400);
  return context;
}

function infoFor(model: Model<string>, providerName: string): CodeModelInfo {
  return {
    provider: model.provider,
    providerName,
    id: model.id,
    name: model.name || model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: Boolean(model.reasoning),
    input: [...model.input],
    thinkingLevels: getSupportedThinkingLevels(model) as string[],
  };
}

function redactor(values: string[]) {
  const secrets = values.filter((value) => value.length >= 6);
  return (text: string) => {
    let out = text;
    for (const secret of secrets) {
      out = out.split(secret).join("[redacted]");
      const escaped = JSON.stringify(secret).slice(1, -1);
      if (escaped !== secret) out = out.split(escaped).join("[redacted]");
    }
    return out;
  };
}

export function createCodeModelGateway(deps: CodeModelGatewayDeps) {
  const catalog = deps.catalog ?? defaultCatalog;

  /** The models the user can use: providers they connected, plus the deployment default. */
  async function listModels(userId: string): Promise<CodeModelInfo[]> {
    const credentials = await deps.prisma.userModelCredential.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: { preferences: { select: { modelId: true } } },
    });
    const providers = new Set(credentials.map((credential) => credential.provider));
    if (deps.deploymentModelKey) providers.add(resolveDeploymentModel().provider);
    const models = catalog();
    const out: CodeModelInfo[] = [];
    for (const provider of models.getProviders()) {
      if (!providers.has(provider.id)) continue;
      if (provider.id === OPENAI_COMPATIBLE_PROVIDER_ID) {
        const ids = new Set(
          credentials
            .filter((credential) => credential.provider === provider.id)
            .flatMap((credential) => credential.preferences.map((p) => p.modelId))
            .filter((id): id is string => Boolean(id)),
        );
        const template = provider.getModels()[0];
        if (template)
          for (const id of ids)
            out.push(infoFor({ ...template, id, name: id } as Model<string>, provider.name));
        continue;
      }
      for (const model of provider.getModels()) out.push(infoFor(model, provider.name));
    }
    return out;
  }

  /** Resolve credentials like an agent run and return framed JSON events. */
  async function* stream(request: CodeStreamRequest): AsyncGenerator<string> {
    const { actor, provider } = request;
    const modelId = request.model.trim();
    if (!provider || !modelId) throw new CodeGatewayError("provider and model are required", 400);
    const credential = await deps.prisma.userModelCredential.findFirst({
      where: { userId: actor.userId, provider },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    if (!credential && !(deps.deploymentModelKey && provider === resolveDeploymentModel().provider))
      throw new CodeGatewayError(`No connected model for ${provider}`, 404);
    const secrets: string[] = [];
    const resolved = await resolveModelKey(
      deps,
      actor.userId,
      actor.spaceId,
      credential,
      provider,
      (values) => secrets.push(...values),
      request.signal,
    ).catch((error: unknown) => {
      throw new CodeGatewayError(
        error instanceof Error ? error.message : "Model connection unavailable",
        409,
      );
    });
    secrets.push(...resolved.redact);
    const redact = redactor(secrets);
    const modelArgs = {
      model: {
        provider,
        id: modelId,
        apiKey: resolved.oauth ? undefined : resolved.apiKey,
        baseUrl: resolved.baseUrl,
        oauth: resolved.oauth
          ? { credential: resolved.oauth, modify: resolved.modifyOAuth }
          : undefined,
      },
    } as Parameters<typeof modelsForRequest>[0];
    const models =
      deps.catalog && !resolved.oauth && !resolved.baseUrl
        ? deps.catalog()
        : modelsForRequest(modelArgs, provider);
    const model = models.getModel(provider, modelId);
    if (!model) throw new CodeGatewayError(`Unknown model ${provider}/${modelId}`, 404);
    const apiKey = resolved.oauth ? undefined : resolved.apiKey;
    const events = models.streamSimple(model, request.context, {
      ...reliableStreamOptions(model, sanitizeCodeStreamOptions(request.options)),
      apiKey,
      signal: request.signal,
    });
    for await (const event of events as AsyncIterable<AssistantMessageEvent>) {
      if (event.type === "done" || event.type === "error") {
        const usage = (event.type === "done" ? event.message : event.error).usage;
        if (usage && request.onUsage) {
          const inputTokens =
            Math.max(0, usage.input ?? 0) +
            Math.max(0, usage.cacheRead ?? 0) +
            Math.max(0, usage.cacheWrite ?? 0);
          const outputTokens = Math.max(0, usage.output ?? 0);
          if (inputTokens || outputTokens)
            await request.onUsage({ provider, model: modelId, inputTokens, outputTokens });
        }
      }
      yield redact(JSON.stringify(event));
    }
  }

  return { listModels, stream };
}

export type CodeModelGateway = ReturnType<typeof createCodeModelGateway>;
