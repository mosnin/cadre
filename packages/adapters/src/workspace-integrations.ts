import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { IsolationError, type Pool, type PrismaClient, requireMembership } from "@rakazo/db";
import * as z from "zod";
import type { EncryptedSecretStore } from "./secrets.js";

export type WorkspaceProvider = "operate" | "stored";
const providers = {
  operate: {
    name: "Operate",
    origin: "https://operate.to",
    resource: "/api/mcp",
    scope: "openid email operate:read operate:write",
  },
  stored: {
    name: "Stored",
    origin: "https://www.stored.to",
    resource: "/mcp",
    scope: "openid profile org:read memory:read memory:write",
  },
} as const;
const Identity = z.object({
  sub: z.string().min(1),
  org_id: z.string().min(1),
  org_name: z.string().min(1),
});
const Tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().positive(),
});
type Actor = { spaceId: string; userId: string };
type Material = { accessToken: string; refreshToken: string; expiresAt: number; clientId: string };
type Grant = {
  id: string;
  externalId: string;
  externalName: string;
  subject: string;
  ciphertext: string;
};

/** The queued memory can never be delivered as stored; retrying would not help. */
class OutboxTerminalError extends Error {}

class ProviderRequestError extends Error {
  constructor(
    readonly status: number,
    provider: string,
  ) {
    super(`${provider} request failed (${status})`);
  }
}

/** A workspace has one immutable target per provider; each user authorizes their own grant. */
export class WorkspaceIntegrations {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      pool: Pool;
      secrets: EncryptedSecretStore;
      webOrigin: string;
      fetcher?: typeof fetch;
    },
  ) {}
  private context(actor: Actor): AdapterContext {
    return {
      ...actor,
      operationId: "workspace-integration",
      traceId: "workspace-integration",
      signal: AbortSignal.timeout(30_000),
    };
  }
  private callback(provider: WorkspaceProvider) {
    return new URL(`/api/v1/workspace-integrations/${provider}/callback`, this.deps.webOrigin).href;
  }
  private async request(provider: WorkspaceProvider, path: string, init: RequestInit) {
    const response = await (this.deps.fetcher ?? fetch)(`${providers[provider].origin}${path}`, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ProviderRequestError(response.status, providers[provider].name);
    return response;
  }
  private async identity(provider: WorkspaceProvider, token: string) {
    return Identity.parse(
      await (
        await this.request(provider, "/oauth/userinfo", {
          headers: { authorization: `Bearer ${token}` },
        })
      ).json(),
    );
  }
  private async exchange(
    provider: WorkspaceProvider,
    clientId: string,
    params: Record<string, string>,
  ): Promise<Material> {
    const tokens = Tokens.parse(
      await (
        await this.request(provider, "/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ...params,
            client_id: clientId,
            resource: `${providers[provider].origin}${providers[provider].resource}`,
          }),
        })
      ).json(),
    );
    return {
      clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
  }
  async validateMemoryBot(actor: Actor, botId: string) {
    const bot = await this.deps.prisma.bot.findFirst({
      where: { id: botId, spaceId: actor.spaceId, userId: actor.userId },
    });
    if (!bot) throw new Error("Private memory requires a bot in this workspace");
  }
  async queueStoredMemory(
    actor: Actor,
    body: Record<string, unknown> & {
      botId: string;
      source: { kind: string; generation?: number };
    },
  ) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    await this.validateMemoryBot(actor, body.botId);
    const id = createHash("sha256")
      .update(JSON.stringify([actor.spaceId, actor.userId, body]))
      .digest("hex");
    const secret = await this.deps.secrets.put(JSON.stringify(body), this.context(actor), id);
    await this.deps.pool.query(
      'INSERT INTO stored_memory_outbox (id,"spaceId","userId","botId",generation,ciphertext) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
      [
        id,
        actor.spaceId,
        actor.userId,
        body.botId,
        body.source.kind === "history" ? body.source.generation : null,
        secret.ciphertext,
      ],
    );
    return id;
  }
  async clearQueuedHistory(actor: Actor, botId: string, generations: number[]) {
    await this.validateMemoryBot(actor, botId);
    await this.deps.pool.query(
      'DELETE FROM stored_memory_outbox WHERE "spaceId"=$1 AND "userId"=$2 AND "botId"=$3 AND generation=ANY($4::int[])',
      [actor.spaceId, actor.userId, botId, generations],
    );
  }
  /** Rows are dropped after this many delivery attempts; the memory is reported as pending long before. */
  static readonly MAX_OUTBOX_ATTEMPTS = 20;
  async flushStoredMemory(id?: string) {
    // Lease without holding a connection during token renewal or network I/O.
    const { rows } = await this.deps.pool.query<{
      id: string;
      spaceId: string;
      userId: string;
      botId: string;
      ciphertext: string;
      attempts: number;
    }>(
      `UPDATE stored_memory_outbox SET attempts=attempts+1,"nextAttemptAt"=NOW()+INTERVAL '2 minutes' WHERE id=(SELECT id FROM stored_memory_outbox WHERE ($1::text IS NULL OR id=$1) AND "nextAttemptAt"<=NOW() ORDER BY "nextAttemptAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [id ?? null],
    );
    const row = rows[0];
    if (!row) return false;
    try {
      await this.validateMemoryBot(row, row.botId).catch((error) => {
        throw new OutboxTerminalError(error instanceof Error ? error.message : "Bot removed");
      });
      const credential = await this.credential("stored", row);
      if (!credential) throw new OutboxTerminalError("Stored disconnected");
      const body = JSON.parse(this.deps.secrets.load(row.ciphertext, row.id));
      await this.request("stored", "/api/cadre/v1/memory", {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...body, action: "save", workspace: row.spaceId }),
      });
      await this.deps.pool.query("DELETE FROM stored_memory_outbox WHERE id=$1 AND attempts=$2", [
        row.id,
        row.attempts,
      ]);
      return true;
    } catch (error) {
      // A row that can never deliver (no grant, bot or membership gone, or a
      // payload Stored rejects) must not sit at the head of the queue forever.
      const retryableStatus =
        error instanceof ProviderRequestError &&
        (error.status === 401 ||
          error.status === 408 ||
          error.status === 429 ||
          error.status >= 500);
      const terminal =
        row.attempts >= WorkspaceIntegrations.MAX_OUTBOX_ATTEMPTS ||
        error instanceof OutboxTerminalError ||
        error instanceof IsolationError ||
        (error instanceof ProviderRequestError && !retryableStatus);
      if (terminal) {
        await this.deps.pool.query("DELETE FROM stored_memory_outbox WHERE id=$1 AND attempts=$2", [
          row.id,
          row.attempts,
        ]);
        return false;
      }
      await this.deps.pool.query(
        `UPDATE stored_memory_outbox SET "nextAttemptAt"=NOW()+LEAST(INTERVAL '5 minutes'*POWER(2,GREATEST(attempts-1,0)),INTERVAL '6 hours') WHERE id=$1 AND attempts=$2`,
        [row.id, row.attempts],
      );
      return false;
    }
  }
  /** True when this user holds credentials for the workspace's Stored organization. */
  async hasLiveStoredGrant(actor: Actor) {
    const { rows } = await this.deps.pool.query(
      `SELECT g.id FROM workspace_integration_grants g JOIN workspace_integrations b ON b.id=g."bindingId" WHERE b."spaceId"=$1 AND b.provider='stored' AND g."userId"=$2 AND g.ciphertext<>''`,
      [actor.spaceId, actor.userId],
    );
    return rows.length > 0;
  }
  async list(actor: Actor) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const { rows } = await this.deps.pool.query(
      `SELECT b.provider,b."externalId",b."externalName",COALESCE(g.ciphertext <> '',false) AS connected FROM workspace_integrations b LEFT JOIN workspace_integration_grants g ON g."bindingId"=b.id AND g."userId"=$2 WHERE b."spaceId"=$1`,
      [actor.spaceId, actor.userId],
    );
    return rows;
  }
  async start(provider: WorkspaceProvider, actor: Actor, sessionId: string) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    let clientId = "stored-cadre";
    if (provider === "operate") {
      const registration = z.object({ client_id: z.string().min(1) }).parse(
        await (
          await this.request(provider, "/oauth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_name: "Cadre",
              redirect_uris: [this.callback(provider)],
              token_endpoint_auth_method: "none",
            }),
          })
        ).json(),
      );
      clientId = registration.client_id;
    }
    const secret = await this.deps.secrets.put(
      JSON.stringify({ verifier, clientId }),
      this.context(actor),
      state,
    );
    await this.deps.pool.query(
      'DELETE FROM workspace_integration_states WHERE "expiresAt"<NOW() OR ("spaceId"=$1 AND "userId"=$2 AND provider=$3)',
      [actor.spaceId, actor.userId, provider],
    );
    await this.deps.pool.query(
      `INSERT INTO workspace_integration_states (state,"spaceId","userId","sessionId",provider,ciphertext,"expiresAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '10 minutes')`,
      [state, actor.spaceId, actor.userId, sessionId, provider, secret.ciphertext],
    );
    const url = new URL("/oauth/authorize", providers[provider].origin);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.callback(provider),
      response_type: "code",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: providers[provider].scope,
      resource: `${providers[provider].origin}${providers[provider].resource}`,
    }).toString();
    return url.href;
  }
  async finish(
    provider: WorkspaceProvider,
    userId: string,
    sessionId: string,
    params: URLSearchParams,
  ) {
    if (params.get("iss") !== providers[provider].origin || !params.get("code"))
      throw new Error("Invalid OAuth callback");
    const { rows } = await this.deps.pool.query<{ spaceId: string; ciphertext: string }>(
      'DELETE FROM workspace_integration_states WHERE state=$1 AND "userId"=$2 AND "sessionId"=$3 AND provider=$4 AND "expiresAt">NOW() RETURNING "spaceId",ciphertext',
      [params.get("state"), userId, sessionId, provider],
    );
    const state = rows[0];
    if (!state) throw new Error("Connection expired");
    const actor = { spaceId: state.spaceId, userId };
    await requireMembership(this.deps.prisma, userId, actor.spaceId);
    const { clientId, verifier } = JSON.parse(
      this.deps.secrets.load(state.ciphertext, params.get("state")!),
    );
    const material = await this.exchange(provider, clientId, {
      grant_type: "authorization_code",
      code: params.get("code")!,
      code_verifier: verifier,
      redirect_uri: this.callback(provider),
    });
    const identity = await this.identity(provider, material.accessToken);
    const connection = await this.deps.pool.connect();
    try {
      await connection.query("BEGIN");
      const membership = await connection.query(
        'SELECT id FROM space_members WHERE "spaceId"=$1 AND "userId"=$2 FOR SHARE',
        [actor.spaceId, userId],
      );
      if (!membership.rowCount) throw new Error("Workspace access removed");
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `integration:${actor.spaceId}:${provider}`,
      ]);
      const existing = await connection.query<{ id: string; externalId: string }>(
        'SELECT id,"externalId" FROM workspace_integrations WHERE "spaceId"=$1 AND provider=$2 FOR UPDATE',
        [actor.spaceId, provider],
      );
      if (existing.rows[0] && existing.rows[0].externalId !== identity.org_id)
        throw new Error("Use a separate Cadre workspace for a different organization");
      const bindingId = existing.rows[0]?.id ?? randomUUID();
      await connection.query(
        'INSERT INTO workspace_integrations (id,"spaceId",provider,"externalId","externalName") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("spaceId",provider) DO UPDATE SET "externalName"=EXCLUDED."externalName"',
        [bindingId, actor.spaceId, provider, identity.org_id, identity.org_name],
      );
      const old = await connection.query<Grant>(
        'SELECT * FROM workspace_integration_grants WHERE "bindingId"=$1 AND "userId"=$2 FOR UPDATE',
        [bindingId, userId],
      );
      if (old.rows[0] && old.rows[0].subject !== identity.sub)
        throw new Error("Reconnect the original account");
      const id = old.rows[0]?.id ?? randomUUID();
      const secret = await this.deps.secrets.put(JSON.stringify(material), this.context(actor), id);
      await connection.query(
        'INSERT INTO workspace_integration_grants (id,"bindingId","userId",subject,ciphertext) VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("bindingId","userId") DO UPDATE SET ciphertext=EXCLUDED.ciphertext',
        [id, bindingId, userId, identity.sub, secret.ciphertext],
      );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    return actor.spaceId;
  }
  async credential(provider: WorkspaceProvider, actor: Actor) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const connection = await this.deps.pool.connect();
    let currentGrant: { id: string; ciphertext: string } | undefined;
    let committed = false;
    try {
      await connection.query("BEGIN");
      const { rows } = await connection.query<Grant>(
        'SELECT g.*,b."externalId",b."externalName" FROM workspace_integration_grants g JOIN workspace_integrations b ON b.id=g."bindingId" WHERE b."spaceId"=$1 AND b.provider=$2 AND g."userId"=$3 FOR UPDATE OF g',
        [actor.spaceId, provider, actor.userId],
      );
      const row = rows[0];
      if (!row?.ciphertext) {
        await connection.query("COMMIT");
        return null;
      }
      currentGrant = { id: row.id, ciphertext: row.ciphertext };
      let material: Material = JSON.parse(this.deps.secrets.load(row.ciphertext, row.id));
      if (material.expiresAt < Date.now() + 60_000) {
        material = await this.exchange(provider, material.clientId, {
          grant_type: "refresh_token",
          refresh_token: material.refreshToken,
        });
        const secret = await this.deps.secrets.put(
          JSON.stringify(material),
          this.context(actor),
          row.id,
        );
        await connection.query(
          "UPDATE workspace_integration_grants SET ciphertext=$1 WHERE id=$2",
          [secret.ciphertext, row.id],
        );
        currentGrant.ciphertext = secret.ciphertext;
      }
      await connection.query("COMMIT");
      committed = true;
      const identity = await this.identity(provider, material.accessToken);
      if (identity.sub !== row.subject || identity.org_id !== row.externalId)
        throw new Error("Organization identity changed");
      return { token: material.accessToken, identity };
    } catch (error) {
      if (!committed) await connection.query("ROLLBACK");
      if (
        currentGrant &&
        error instanceof ProviderRequestError &&
        (error.status === 401 || error.status === 403 || (!committed && error.status === 400))
      ) {
        // Compare ciphertext so a concurrent successful reconnect is preserved.
        const removed = await connection.query(
          "UPDATE workspace_integration_grants SET ciphertext='' WHERE id=$1 AND ciphertext=$2",
          [currentGrant.id, currentGrant.ciphertext],
        );
        if (removed.rowCount) await this.disable(provider, actor);
      }
      throw error;
    } finally {
      connection.release();
    }
  }
  private async disable(provider: WorkspaceProvider, actor: Actor) {
    // Only the servers this class creates; users may name their own servers "stored-notes".
    await this.deps.prisma.mcpServer.updateMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        enabled: true,
        OR: [
          { slug: `${provider}-workspace` },
          ...(provider === "stored" ? [{ slug: { startsWith: "stored-agent-" } }] : []),
        ],
      },
      data: { enabled: false, revision: { increment: 1 } },
    });
  }
  async disconnect(provider: WorkspaceProvider, actor: Actor) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const connection = await this.deps.pool.connect();
    let material: Material | undefined;
    try {
      await connection.query("BEGIN");
      const { rows } = await connection.query<Grant>(
        'SELECT g.* FROM workspace_integration_grants g JOIN workspace_integrations b ON b.id=g."bindingId" WHERE b."spaceId"=$1 AND b.provider=$2 AND g."userId"=$3 FOR UPDATE OF g',
        [actor.spaceId, provider, actor.userId],
      );
      const row = rows[0];
      if (row?.ciphertext) material = JSON.parse(this.deps.secrets.load(row.ciphertext, row.id));
      if (row)
        await connection.query(
          "UPDATE workspace_integration_grants SET ciphertext='' WHERE id=$1",
          [row.id],
        );
      if (provider === "stored")
        await connection.query(
          'DELETE FROM stored_memory_outbox WHERE "spaceId"=$1 AND "userId"=$2',
          [actor.spaceId, actor.userId],
        );
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
    await this.disable(provider, actor);
    if (material)
      await this.request(provider, "/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: material.refreshToken,
          client_id: material.clientId,
          token_type_hint: "refresh_token",
        }),
      }).catch(() => {});
  }

  async prepare(context: AdapterContext) {
    context.workspaceIntegrations = {};
    if (!context.botId) return;
    const bot = await this.deps.prisma.bot.findFirst({
      where: { id: context.botId, spaceId: context.spaceId, userId: context.userId },
      select: { id: true },
    });
    if (!bot) return;
    for (const provider of ["operate", "stored"] as const) {
      const { rows: live } = await this.deps.pool.query(
        `SELECT g.id FROM workspace_integration_grants g JOIN workspace_integrations b ON b.id=g."bindingId" WHERE b."spaceId"=$1 AND b.provider=$2 AND g."userId"=$3 AND g.ciphertext<>''`,
        [context.spaceId, provider, context.userId],
      );
      if (!live.length) {
        await this.disable(provider, context);
        continue;
      }
      let credential: Awaited<ReturnType<WorkspaceIntegrations["credential"]>>;
      try {
        credential = await this.credential(provider, context);
      } catch {
        await this.disable(provider, context);
        continue;
      }
      if (!credential) {
        await this.disable(provider, context);
        continue;
      }
      context.workspaceIntegrations[provider] = {
        id: credential.identity.org_id,
        name: credential.identity.org_name,
      };
      const targets: Array<{ slug: string; name: string; endpoint: string }> = [
        {
          slug: `${provider}-workspace`,
          name: providers[provider].name,
          endpoint: `${providers[provider].origin}${providers[provider].resource}`,
        },
      ];
      if (provider === "stored")
        targets.push({
          slug: `stored-agent-${context.botId}`,
          name: "Stored private agent memory",
          endpoint: `${providers.stored.origin}/mcp/cadre/${encodeURIComponent(context.spaceId)}/${encodeURIComponent(context.botId)}`,
        });
      for (const target of targets) {
        const where = {
          spaceId_userId_slug: {
            spaceId: context.spaceId,
            userId: context.userId,
            slug: target.slug,
          },
        };
        const existing = await this.deps.prisma.mcpServer.findUnique({
          where,
          include: { secret: true },
        });
        const plaintext = JSON.stringify({ secret: credential.token });
        let server = existing;
        if (
          !existing?.secret ||
          this.deps.secrets.load(existing.secret.ciphertext, existing.secret.id) !== plaintext ||
          !existing.enabled ||
          existing.endpoint !== target.endpoint ||
          existing.transport !== "streamable_http"
        ) {
          const secret = await this.deps.secrets.put(plaintext, context);
          server = await this.deps.prisma.$transaction(async (tx) => {
            await tx.secret.create({
              data: {
                id: secret.id,
                ciphertext: secret.ciphertext,
                kind: "mcp",
                spaceId: context.spaceId,
                userId: context.userId,
              },
            });
            return tx.mcpServer.upsert({
              where,
              create: {
                ...where.spaceId_userId_slug,
                name: target.name,
                endpoint: target.endpoint,
                transport: "streamable_http",
                secretId: secret.id,
              },
              update: {
                secretId: secret.id,
                endpoint: target.endpoint,
                transport: "streamable_http",
                name: target.name,
                enabled: true,
                revision: { increment: 1 },
              },
              include: { secret: true },
            });
          });
        }
        await this.deps.prisma.botMcpServer.upsert({
          where: { botId_serverId: { botId: context.botId, serverId: server!.id } },
          create: {
            spaceId: context.spaceId,
            userId: context.userId,
            botId: context.botId,
            serverId: server!.id,
            allowAllTools: true,
          },
          update: { allowAllTools: true },
        });
      }
    }
  }
}
