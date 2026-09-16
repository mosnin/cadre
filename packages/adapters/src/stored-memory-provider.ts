import type {
  AdapterContext,
  SemanticMemoryProvider,
  SemanticMemoryRecallRequest,
  SemanticMemoryResponse,
  SemanticMemoryResult,
  SemanticMemorySaveRequest,
} from "@rakazo/adapter-kit";
import { z } from "zod";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import type { WorkspaceIntegrations } from "./workspace-integrations.js";

/** Use the same rotating workspace grant for automatic recall/save and tools. */
class StoredMemoryProvider implements SemanticMemoryProvider {
  constructor(private readonly integrations: WorkspaceIntegrations) {}
  describe() {
    return {
      id: "stored",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { recall: true, save: true, purgeHistory: true, sharedScope: true } as const,
    };
  }
  private async call(body: Record<string, unknown> & { botId: string }, context: AdapterContext) {
    if (context.botId && body.botId !== context.botId)
      throw new Error("Private memory requires the current bot");
    await this.integrations.validateMemoryBot(context, body.botId);
    const credential = await this.integrations.credential("stored", context);
    if (!credential) throw new Error("Reconnect Stored in workspace Settings");
    const response = await fetch("https://www.stored.to/api/cadre/v1/memory", {
      method: "POST",
      headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...body, workspace: context.spaceId }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(15000)]),
    });
    if (!response.ok) throw new Error(`Stored memory request failed (${response.status})`);
    return response.json();
  }
  async recall(
    request: SemanticMemoryRecallRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<SemanticMemoryResult[]>> {
    try {
      const result = await this.call({ ...request, action: "recall" }, context);
      return {
        ok: true,
        value: z
          .array(
            z.object({
              memory: z.string(),
              score: z.number().finite(),
              updatedAt: z.string().optional(),
            }),
          )
          .max(100)
          .parse(result.results),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Stored recall failed" };
    }
  }
  async save(
    request: SemanticMemorySaveRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse> {
    try {
      const id = await this.integrations.queueStoredMemory(context, { ...request });
      if (!(await this.integrations.flushStoredMemory(id)))
        return { ok: false, error: "Memory saved locally. Stored sync is pending and will retry." };
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Stored save failed" };
    }
  }
  async purgeHistory(
    request: { botId: string; generations: number[] },
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse> {
    try {
      await this.integrations.clearQueuedHistory(context, request.botId, request.generations);
      await this.call({ ...request, action: "purgeHistory" }, context);
      return { ok: true, value: undefined };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Stored history removal failed",
      };
    }
  }
}
export class ConnectedMemoryProviderResolver implements MemoryProviderResolver {
  constructor(
    private readonly fallback: MemoryProviderResolver,
    private readonly integrations?: WorkspaceIntegrations,
  ) {}
  async resolve(spaceId: string) {
    if (this.integrations && (await this.integrations.hasStoredBinding(spaceId)))
      return {
        provider: new StoredMemoryProvider(this.integrations),
        defaultScope: "isolated" as const,
      };
    return this.fallback.resolve(spaceId);
  }
}
