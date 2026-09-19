import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AdapterContext } from "@cadre/adapter-kit";
import { type Pool, type PrismaClient, requireMembership } from "@cadre/db";
import { getLogger } from "@cadre/logging";
import * as z from "zod";
import type { EncryptedSecretStore } from "./secrets.js";

const SLUG = "company-os-context";
const Identity = z.object({
  sub: z.string().min(1),
  client_id: z.string(),
  company: z.object({ id: z.string().min(1), name: z.string().min(1), slug: z.string().min(1) }),
  capabilities: z.array(z.string()),
});
const Tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().refine((v) => v.toLowerCase() === "bearer"),
  expires_in: z.number().positive(),
});
type Grant = {
  id: string;
  spaceId: string;
  userId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  subject: string;
  ciphertext: string;
};
type Material = { accessToken: string; refreshToken: string; expiresAt: number };
export type CompanyWorkspaceConfig = { origin: string; clientId: string; clientSecret: string };
export function companyWorkspaceConfig(env = process.env): CompanyWorkspaceConfig | undefined {
  if (!env.COMPANY_OS_OAUTH_CLIENT_ID && !env.COMPANY_OS_OAUTH_CLIENT_SECRET) return;
  const origin = new URL(env.COMPANY_OS_OAUTH_ORIGIN ?? "https://www.companyos.sh");
  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("Company OS requires an HTTPS origin");
  if (!env.COMPANY_OS_OAUTH_CLIENT_ID || !env.COMPANY_OS_OAUTH_CLIENT_SECRET)
    throw new Error("Company OS OAuth client is not configured");
  return {
    origin: origin.origin,
    clientId: env.COMPANY_OS_OAUTH_CLIENT_ID,
    clientSecret: env.COMPANY_OS_OAUTH_CLIENT_SECRET,
  };
}

/** Grants are scoped to both workspace and account; tokens never leave the server. */
export class CompanyWorkspaces {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      pool: Pool;
      secrets: EncryptedSecretStore;
      config: CompanyWorkspaceConfig;
      webOrigin: string;
      fetcher?: typeof fetch;
    },
  ) {}
  private context(actor: { spaceId: string; userId: string }): AdapterContext {
    return {
      ...actor,
      operationId: "company-workspace",
      traceId: "company-workspace",
      signal: AbortSignal.timeout(30000),
    };
  }
  private get callback() {
    return new URL("/api/v1/company-workspaces/callback", this.deps.webOrigin).href;
  }
  private async request(path: string, init: RequestInit) {
    const response = await (this.deps.fetcher ?? fetch)(`${this.deps.config.origin}${path}`, {
      ...init,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Reconnect Company OS to continue");
    return response;
  }
  private async identity(token: string) {
    const value = Identity.parse(
      await (
        await this.request("/api/oauth/userinfo", { headers: { authorization: `Bearer ${token}` } })
      ).json(),
    );
    if (
      value.client_id !== this.deps.config.clientId ||
      !value.capabilities.includes("context:read")
    )
      throw new Error("Company OS context permission is required");
    return value;
  }
  private async exchange(params: Record<string, string>): Promise<Material> {
    const value = Tokens.parse(
      await (
        await this.request("/api/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            ...params,
            client_id: this.deps.config.clientId,
            client_secret: this.deps.config.clientSecret,
            resource: `${this.deps.config.origin}/api/mcp`,
          }),
        })
      ).json(),
    );
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: Date.now() + value.expires_in * 1000,
    };
  }
  async list(userId: string) {
    const { rows } = await this.deps.pool.query<
      Pick<Grant, "id" | "spaceId" | "companyId" | "companyName" | "companySlug"> & {
        connected: boolean;
      }
    >(
      `SELECT id, "spaceId", "companyId", "companyName", "companySlug", (ciphertext <> '') AS connected FROM company_workspace_grants WHERE "userId" = $1`,
      [userId],
    );
    const visible = [];
    for (const row of rows) {
      if (await requireMembership(this.deps.prisma, userId, row.spaceId).catch(() => null))
        visible.push(row);
    }
    return visible;
  }
  async start(
    actor: { spaceId: string; userId: string },
    sessionId: string,
    createCompany = false,
  ) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const secret = await this.deps.secrets.put(verifier, this.context(actor), state);
    await this.deps.pool.query(
      'DELETE FROM company_workspace_oauth_states WHERE "expiresAt" < NOW() OR ("userId" = $1 AND "spaceId" = $2)',
      [actor.userId, actor.spaceId],
    );
    await this.deps.pool.query(
      'INSERT INTO company_workspace_oauth_states (state, "spaceId", "userId", "sessionId", ciphertext, "expiresAt") VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL \'10 minutes\')',
      [state, actor.spaceId, actor.userId, sessionId, secret.ciphertext],
    );
    const url = new URL("/oauth/authorize", this.deps.config.origin);
    url.search = new URLSearchParams({
      client_id: this.deps.config.clientId,
      redirect_uri: this.callback,
      response_type: "code",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      scope: "context:read context:write branch:create",
      resource: `${this.deps.config.origin}/api/mcp`,
    }).toString();
    if (createCompany) url.searchParams.set("screen_hint", "create_company");
    return url.href;
  }
  async finish(userId: string, sessionId: string, params: URLSearchParams) {
    if (params.get("iss") !== this.deps.config.origin || !params.get("code"))
      throw new Error("Invalid Company OS callback");
    const { rows } = await this.deps.pool.query<{ spaceId: string; ciphertext: string }>(
      'DELETE FROM company_workspace_oauth_states WHERE state=$1 AND "userId"=$2 AND "sessionId"=$3 AND "expiresAt">NOW() RETURNING "spaceId", ciphertext',
      [params.get("state"), userId, sessionId],
    );
    const state = rows[0];
    if (!state) throw new Error("Company OS connection expired");
    const actor = await requireMembership(this.deps.prisma, userId, state.spaceId);
    const material = await this.exchange({
      grant_type: "authorization_code",
      code: params.get("code")!,
      redirect_uri: this.callback,
      code_verifier: this.deps.secrets.load(state.ciphertext, params.get("state")!),
    });
    const identity = await this.identity(material.accessToken);
    const lock = await this.deps.pool.connect();
    try {
      await lock.query("BEGIN");
      // Keep membership valid through the binding commit, including revocation during consent.
      const membership = await lock.query(
        'SELECT id FROM space_members WHERE "spaceId"=$1 AND "userId"=$2 FOR SHARE',
        [actor.spaceId, userId],
      );
      if (!membership.rowCount) throw new Error("Workspace access was removed");
      // Serialize both account identity and workspace binding, including concurrent callbacks.
      await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `company-account:${userId}`,
      ]);
      await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `company-space:${actor.spaceId}`,
      ]);
      const binding = await lock.query<{ companyOsCompanyId: string | null }>(
        'SELECT "companyOsCompanyId" FROM spaces WHERE id=$1 FOR UPDATE',
        [actor.spaceId],
      );
      if (
        binding.rows[0]?.companyOsCompanyId &&
        binding.rows[0].companyOsCompanyId !== identity.company.id
      )
        throw new Error("Use a separate workspace for a different company");
      const workforce = await lock.query(
        'SELECT id FROM workforce_connections WHERE "spaceId"=$1 AND "companySlug"<>$2',
        [actor.spaceId, identity.company.slug],
      );
      if (workforce.rowCount) throw new Error("Use a separate workspace for a different company");
      const other = await lock.query(
        `SELECT id FROM company_workspace_grants WHERE ("spaceId"=$1 AND "companyId"<>$2) OR ("userId"=$3 AND subject<>$4 AND ciphertext<>'')`,
        [actor.spaceId, identity.company.id, userId, identity.sub],
      );
      if (other.rowCount) throw new Error("Use a separate workspace for a different company");
      await lock.query(
        'UPDATE spaces SET "companyOsCompanyId"=$1,"companyOsCompanyName"=$2,"companyOsCompanySlug"=$3 WHERE id=$4',
        [identity.company.id, identity.company.name, identity.company.slug, actor.spaceId],
      );
      const old = await lock.query<Grant>(
        'SELECT * FROM company_workspace_grants WHERE "spaceId"=$1 AND "userId"=$2 FOR UPDATE',
        [actor.spaceId, userId],
      );
      const id = old.rows[0]?.id ?? randomUUID();
      const encrypted = await this.deps.secrets.put(
        JSON.stringify(material),
        this.context(actor),
        id,
      );
      await lock.query(
        'INSERT INTO company_workspace_grants (id,"spaceId","userId","companyId","companyName","companySlug",subject,ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT ("spaceId","userId") DO UPDATE SET ciphertext=EXCLUDED.ciphertext,"companyId"=EXCLUDED."companyId","companyName"=EXCLUDED."companyName","companySlug"=EXCLUDED."companySlug",subject=EXCLUDED.subject',
        [
          id,
          actor.spaceId,
          userId,
          identity.company.id,
          identity.company.name,
          identity.company.slug,
          identity.sub,
          encrypted.ciphertext,
        ],
      );
      await lock.query("COMMIT");
    } catch (error) {
      await lock.query("ROLLBACK");
      throw error;
    } finally {
      lock.release();
    }
    await this.syncWorkspace(actor, material.accessToken).catch(() =>
      getLogger().warn("company_workspace.sync_failed"),
    );
    return actor.spaceId;
  }
  private async syncWorkspace(actor: { spaceId: string; userId: string }, token: string) {
    const space = await this.deps.prisma.space.findUniqueOrThrow({ where: { id: actor.spaceId } });
    const agents = await this.deps.prisma.bot.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      select: { id: true, name: true },
      take: 500,
    });
    await this.request("/api/oauth/cadre-sync", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: actor.spaceId, name: space.name, agents }),
    });
  }
  async credential(actor: { spaceId: string; userId: string }) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const lock = await this.deps.pool.connect();
    try {
      await lock.query("BEGIN");
      const { rows } = await lock.query<Grant>(
        'SELECT * FROM company_workspace_grants WHERE "spaceId"=$1 AND "userId"=$2 FOR UPDATE',
        [actor.spaceId, actor.userId],
      );
      const row = rows[0];
      if (!row?.ciphertext) {
        await lock.query("COMMIT");
        return null;
      }
      let material = JSON.parse(this.deps.secrets.load(row.ciphertext, row.id)) as Material;
      if (material.expiresAt < Date.now() + 60000) {
        material = await this.exchange({
          grant_type: "refresh_token",
          refresh_token: material.refreshToken,
        });
        const secret = await this.deps.secrets.put(
          JSON.stringify(material),
          this.context(actor),
          row.id,
        );
        await lock.query("UPDATE company_workspace_grants SET ciphertext=$1 WHERE id=$2", [
          secret.ciphertext,
          row.id,
        ]);
      }
      // Commit rotated credentials before userinfo: a transient identity failure must not lose a single-use refresh token.
      await lock.query("COMMIT");
      const identity = await this.identity(material.accessToken);
      if (identity.sub !== row.subject || identity.company.id !== row.companyId)
        throw new Error("Company OS identity changed");
      return { token: material.accessToken, identity };
    } catch (error) {
      await lock.query("ROLLBACK");
      throw error;
    } finally {
      lock.release();
    }
  }
  async disconnect(actor: { spaceId: string; userId: string }) {
    await requireMembership(this.deps.prisma, actor.userId, actor.spaceId);
    const lock = await this.deps.pool.connect();
    let material: Material | undefined;
    try {
      await lock.query("BEGIN");
      const { rows } = await lock.query<Grant>(
        'SELECT * FROM company_workspace_grants WHERE "spaceId"=$1 AND "userId"=$2 FOR UPDATE',
        [actor.spaceId, actor.userId],
      );
      const row = rows[0];
      if (row?.ciphertext)
        material = JSON.parse(this.deps.secrets.load(row.ciphertext, row.id)) as Material;
      await lock.query(
        `UPDATE company_workspace_grants SET ciphertext='' WHERE "spaceId"=$1 AND "userId"=$2`,
        [actor.spaceId, actor.userId],
      );
      await lock.query("COMMIT");
    } catch (error) {
      await lock.query("ROLLBACK");
      throw error;
    } finally {
      lock.release();
    }
    await this.disable(actor);
    if (material) {
      // Local access is removed even if the provider cannot currently revoke the grant.
      await this.request("/api/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: material.refreshToken,
          token_type_hint: "refresh_token",
          client_id: this.deps.config.clientId,
          client_secret: this.deps.config.clientSecret,
        }),
      }).catch(() => {});
    }
  }
  private async disable(actor: { spaceId: string; userId: string }) {
    await this.deps.prisma.mcpServer.updateMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, slug: SLUG },
      data: { enabled: false, revision: { increment: 1 } },
    });
  }
  async prepare(context: AdapterContext) {
    context.companyWorkspace = undefined;
    if (!context.botId) return;
    // Most runs have no Company OS grant; skip the locked refresh and provider
    // round trips entirely and just make sure no stale server stays enabled.
    const live = await this.deps.prisma.companyWorkspaceGrant.findFirst({
      where: { spaceId: context.spaceId, userId: context.userId, ciphertext: { not: "" } },
      select: { id: true },
    });
    if (!live) {
      await this.disable(context);
      return;
    }
    let credential: Awaited<ReturnType<CompanyWorkspaces["credential"]>>;
    try {
      credential = await this.credential(context);
    } catch (error) {
      await this.disable(context);
      throw error;
    }
    if (!credential) {
      await this.disable(context);
      return;
    }
    context.companyWorkspace = credential.identity.company;
    await this.syncWorkspace(context, credential.token).catch(() =>
      getLogger().warn("company_workspace.sync_failed"),
    );
    const bot = await this.deps.prisma.bot.findFirst({
      where: { id: context.botId, spaceId: context.spaceId, userId: context.userId },
    });
    if (!bot) throw new Error("Company context requires a workspace bot");
    const where = {
      spaceId_userId_slug: { spaceId: context.spaceId, userId: context.userId, slug: SLUG },
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
      existing.endpoint !== `${this.deps.config.origin}/api/mcp`
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
        const upserted = await tx.mcpServer.upsert({
          where,
          create: {
            spaceId: context.spaceId,
            userId: context.userId,
            slug: SLUG,
            name: "Company OS",
            endpoint: `${this.deps.config.origin}/api/mcp`,
            transport: "streamable_http",
            secretId: secret.id,
          },
          update: {
            endpoint: `${this.deps.config.origin}/api/mcp`,
            transport: "streamable_http",
            secretId: secret.id,
            enabled: true,
            revision: { increment: 1 },
          },
          include: { secret: true },
        });
        // The rotated token replaces the previous secret; nothing else references it.
        if (existing?.secretId && existing.secretId !== secret.id) {
          await tx.secret.deleteMany({
            where: { id: existing.secretId, spaceId: context.spaceId, userId: context.userId },
          });
        }
        return upserted;
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
