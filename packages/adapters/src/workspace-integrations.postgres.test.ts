import { createHash, randomUUID } from "node:crypto";
import { bootstrapUserSpace, createDb, createSpaceForMember, requireMembership } from "@cadre/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EncryptedSecretStore } from "./secrets.js";
import { WorkspaceIntegrations, type WorkspaceProvider } from "./workspace-integrations.js";

const suite =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
suite("native workspace OAuth", () => {
  const userId = randomUUID();
  const secrets = new EncryptedSecretStore("integration-test-only");
  let db: ReturnType<typeof createDb>;
  let service: WorkspaceIntegrations;
  let first: Awaited<ReturnType<typeof requireMembership>>;
  let second: typeof first;
  let target = "organization-one";
  let challenge = "";
  let refreshes = 0;
  let revoked = 0;
  let memoryFailure = true;
  let memoryStatus = 503;
  const saved: Record<string, unknown>[] = [];
  const tokens = new Map<string, string>();
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const user = await db.prisma.user.create({
      data: { id: userId, name: "Test", email: `${userId}@example.test` },
    });
    await bootstrapUserSpace(db.prisma, user, { signupsEnabled: "true", signupAllowlist: "" });
    first = await requireMembership(db.prisma, userId);
    const space = await createSpaceForMember(db.prisma, {
      currentSpaceId: first.spaceId,
      userId,
      name: "Separate",
    });
    second = await requireMembership(db.prisma, userId, space.id);
    service = new WorkspaceIntegrations({
      prisma: db.prisma,
      pool: db.pool!,
      secrets,
      webOrigin: "https://cadre.to",
      fetcher: async (url, init) => {
        expect(init?.redirect).toBe("error");
        if (String(url).endsWith("/api/cadre/v1/memory")) {
          if (memoryFailure) return new Response(null, { status: memoryStatus });
          saved.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        if (String(url).endsWith("/register"))
          return Response.json({ client_id: "registered-operate" });
        if (String(url).endsWith("/revoke")) {
          revoked++;
          return new Response(null, { status: 200 });
        }
        if (String(url).endsWith("/token")) {
          const params = new URLSearchParams(String(init?.body));
          expect(params.has("client_secret")).toBe(false);
          const refresh = params.get("grant_type") === "refresh_token";
          if (refresh) refreshes++;
          else
            expect(
              createHash("sha256").update(params.get("code_verifier")!).digest("base64url"),
            ).toBe(challenge);
          const token = randomUUID();
          tokens.set(token, refresh ? tokens.get(params.get("refresh_token")!)! : target);
          return Response.json({
            access_token: token,
            refresh_token: token,
            expires_in: 3600,
            token_type: "Bearer",
          });
        }
        const token = new Headers(init?.headers).get("authorization")!.slice(7);
        return Response.json({
          sub: "account",
          org_id: tokens.get(token),
          org_name: tokens.get(token),
        });
      },
    });
  });
  afterAll(async () => {
    const member = await db.prisma.spaceMember.findFirst({ where: { userId } });
    if (member) await db.prisma.organization.delete({ where: { id: member.organizationId } });
    await db.prisma.user.delete({ where: { id: userId } });
    await db.prisma.$disconnect();
    await db.pool?.end();
  });
  async function start(provider: WorkspaceProvider, actor = first) {
    const url = new URL(await service.start(provider, actor, "session"));
    challenge = url.searchParams.get("code_challenge")!;
    return new URLSearchParams({
      state: url.searchParams.get("state")!,
      iss: url.origin,
      code: "code",
    });
  }
  it("binds PKCE state to provider, session, user and single use", async () => {
    const params = await start("stored");
    await expect(service.finish("stored", userId, "other", params)).rejects.toThrow();
    await expect(service.finish("operate", userId, "session", params)).rejects.toThrow();
    expect(await service.finish("stored", userId, "session", params)).toBe(first.spaceId);
    await expect(service.finish("stored", userId, "session", params)).rejects.toThrow();
    expect(await service.list(first)).toEqual([
      expect.objectContaining({ provider: "stored", externalId: target, connected: true }),
    ]);
  });
  it("keeps multiple workspaces isolated and refuses replacing a bound organization", async () => {
    target = "organization-two";
    await expect(
      service.finish("stored", userId, "session", await start("stored")),
    ).rejects.toThrow(/separate/);
    await service.finish("stored", userId, "session", await start("stored", second));
    expect((await service.credential("stored", first))?.identity.org_id).toBe("organization-one");
    expect((await service.credential("stored", second))?.identity.org_id).toBe("organization-two");
  });
  it("registers Operate independently and serializes rotating refresh tokens", async () => {
    await service.finish("operate", userId, "session", await start("operate"));
    const { rows } = await db.pool!.query(
      'SELECT g.* FROM workspace_integration_grants g JOIN workspace_integrations b ON b.id=g."bindingId" WHERE b."spaceId"=$1 AND provider=$2',
      [first.spaceId, "operate"],
    );
    const row = rows[0];
    const material = JSON.parse(secrets.load(row.ciphertext, row.id));
    material.expiresAt = 0;
    const encrypted = await secrets.put(
      JSON.stringify(material),
      { ...first, operationId: "test", traceId: "test", signal: AbortSignal.timeout(5000) },
      row.id,
    );
    await db.pool!.query("UPDATE workspace_integration_grants SET ciphertext=$1 WHERE id=$2", [
      encrypted.ciphertext,
      row.id,
    ]);
    await Promise.all([service.credential("operate", first), service.credential("operate", first)]);
    expect(refreshes).toBe(1);
    // A second connection reuses the client this deployment already registered.
    await start("operate");
    expect(
      await db.prisma.workspaceIntegrationClient.count({ where: { provider: "operate" } }),
    ).toBe(1);
  });
  it("encrypts, deduplicates and retries memory without crossing workspaces", async () => {
    const bot = await db.prisma.bot.create({
      data: { spaceId: first.spaceId, userId, name: "Memory test", color: "green" },
    });
    const body = {
      botId: bot.id,
      content: "Private durable fact",
      scope: "isolated",
      source: { kind: "durable" },
    };
    const id = await service.queueStoredMemory(first, body);
    expect(await service.queueStoredMemory(first, body)).toBe(id);
    await expect(service.queueStoredMemory(second, body)).rejects.toThrow(/workspace/);
    expect(await service.flushStoredMemory(id)).toBe(false);
    const { rows } = await db.pool!.query("SELECT * FROM stored_memory_outbox WHERE id=$1", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ciphertext).not.toContain(body.content);
    expect(rows[0].attempts).toBe(1);
    memoryFailure = false;
    await db.pool!.query('UPDATE stored_memory_outbox SET "nextAttemptAt"=NOW() WHERE id=$1', [id]);
    expect(await service.flushStoredMemory(id)).toBe(true);
    expect(saved).toEqual([
      expect.objectContaining({ workspace: first.spaceId, botId: bot.id, content: body.content }),
    ]);
    expect(
      (await db.pool!.query("SELECT id FROM stored_memory_outbox WHERE id=$1", [id])).rows,
    ).toHaveLength(0);
    const history = await service.queueStoredMemory(first, {
      ...body,
      source: { kind: "history", generation: 2 },
    });
    await service.clearQueuedHistory(first, bot.id, [2]);
    expect(await service.flushStoredMemory(history)).toBe(false);
    // A payload Stored rejects is dropped instead of retried forever.
    const rejected = await service.queueStoredMemory(first, { ...body, content: "Rejected" });
    memoryFailure = true;
    memoryStatus = 422;
    expect(await service.flushStoredMemory(rejected)).toBe(false);
    expect(
      (await db.pool!.query("SELECT id FROM stored_memory_outbox WHERE id=$1", [rejected])).rows,
    ).toHaveLength(0);
    memoryStatus = 503;
    expect(await service.hasLiveStoredGrant(first)).toBe(true);
    expect(await service.hasLiveStoredGrant({ spaceId: first.spaceId, userId: randomUUID() })).toBe(
      false,
    );
  });
  it("disconnects and revokes without losing the workspace identity", async () => {
    const bot = await db.prisma.bot.findFirstOrThrow({ where: { spaceId: first.spaceId, userId } });
    const queued = await service.queueStoredMemory(first, {
      botId: bot.id,
      content: "Queued before disconnect",
      scope: "isolated",
      source: { kind: "durable" },
    });
    const own = await db.prisma.mcpServer.create({
      data: {
        spaceId: first.spaceId,
        userId,
        slug: "stored-notes",
        name: "My notes",
        endpoint: "https://notes.example/mcp",
        transport: "streamable_http",
      },
    });
    await service.disconnect("stored", first);
    expect(revoked).toBe(1);
    expect(await service.credential("stored", first)).toBeNull();
    expect(await service.hasLiveStoredGrant(first)).toBe(false);
    expect(
      (await db.pool!.query("SELECT id FROM stored_memory_outbox WHERE id=$1", [queued])).rows,
    ).toHaveLength(0);
    expect((await db.prisma.mcpServer.findUniqueOrThrow({ where: { id: own.id } })).enabled).toBe(
      true,
    );
    expect((await service.list(first)).find((x) => x.provider === "stored")).toMatchObject({
      connected: false,
      externalId: "organization-one",
    });
    expect((await service.credential("stored", second))?.identity.org_id).toBe("organization-two");
  });
});
