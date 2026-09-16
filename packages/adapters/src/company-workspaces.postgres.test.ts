import { createHash, randomUUID } from "node:crypto";
import {
  bootstrapUserSpace,
  createDb,
  createRepos,
  createSpaceForMember,
  requireMembership,
} from "@rakazo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CompanyWorkspaces, companyWorkspaceConfig } from "./company-workspaces.js";
import { EncryptedSecretStore } from "./secrets.js";

const suite =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;
describe("Company workspace configuration", () => {
  it("is optional and validates its confidential client", () => {
    expect(companyWorkspaceConfig({})).toBeUndefined();
    expect(() => companyWorkspaceConfig({ COMPANY_OS_OAUTH_CLIENT_ID: "client" })).toThrow();
    for (const origin of [
      "http://example.test",
      "https://user:password@example.test",
      "https://example.test/path",
      "https://example.test?x=1",
    ]) {
      expect(() =>
        companyWorkspaceConfig({
          COMPANY_OS_OAUTH_CLIENT_ID: "client",
          COMPANY_OS_OAUTH_CLIENT_SECRET: "secret",
          COMPANY_OS_OAUTH_ORIGIN: origin,
        }),
      ).toThrow();
    }
  });
});
suite("Company workspace OAuth isolation", () => {
  const config = {
    origin: "https://company.example",
    clientId: "test-client",
    clientSecret: "test-secret",
  };
  const userId = randomUUID();
  const secrets = new EncryptedSecretStore("test-encryption-key-only");
  let db: ReturnType<typeof createDb>;
  let service: CompanyWorkspaces;
  let first: Awaited<ReturnType<typeof requireMembership>>;
  let second: typeof first;
  let company = "one";
  let subject = "company-account";
  let clientId = config.clientId;
  let revoked = false;
  let refreshCount = 0;
  let challenge = "";
  let removeMembershipOnIdentity: string | undefined;
  const grants = new Map<string, { company: string; subject: string }>();
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    if (String(url).endsWith("/cadre-sync")) {
      const body = JSON.parse(String(init?.body));
      expect([first.spaceId, second.spaceId]).toContain(body.workspaceId);
      expect(body).not.toHaveProperty("companyId");
      expect(body.agents).toBeInstanceOf(Array);
      return Response.json({ syncedAt: Date.now() });
    }
    if (String(url).endsWith("/token")) {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("client_id")).toBe(config.clientId);
      expect(params.get("client_secret")).toBe(config.clientSecret);
      expect(params.get("resource")).toBe(`${config.origin}/api/mcp`);
      if (params.get("grant_type") === "authorization_code") {
        expect(createHash("sha256").update(params.get("code_verifier")!).digest("base64url")).toBe(
          challenge,
        );
        expect(params.get("redirect_uri")).toBe(
          "https://cadre.example/api/v1/company-workspaces/callback",
        );
      } else refreshCount++;
      const token = randomUUID();
      const identity =
        params.get("grant_type") === "refresh_token"
          ? grants.get(params.get("refresh_token")!)!
          : { company, subject };
      grants.set(token, identity);
      return Response.json({
        access_token: token,
        refresh_token: token,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (String(url).endsWith("/revoke")) return new Response(null, { status: 200 });
    if (revoked) return new Response(null, { status: 401 });
    const token = new Headers(init?.headers).get("authorization")!.replace("Bearer ", "");
    const grant = grants.get(token)!;
    if (removeMembershipOnIdentity) {
      await db.prisma.spaceMember.delete({
        where: { spaceId_userId: { spaceId: removeMembershipOnIdentity, userId } },
      });
      removeMembershipOnIdentity = undefined;
    }
    return Response.json({
      sub: grant.subject,
      client_id: clientId,
      company: { id: grant.company, name: `Company ${grant.company}`, slug: grant.company },
      capabilities: ["context:read"],
    });
  });
  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    const user = await db.prisma.user.create({
      data: { id: userId, name: "Workspace fixture", email: `${userId}@example.test` },
    });
    await bootstrapUserSpace(db.prisma, user, { signupsEnabled: "true", signupAllowlist: "" });
    first = await requireMembership(db.prisma, userId);
    const space = await createSpaceForMember(db.prisma, {
      currentSpaceId: first.spaceId,
      userId,
      name: "Second",
    });
    second = await requireMembership(db.prisma, userId, space.id);
    service = new CompanyWorkspaces({
      prisma: db.prisma,
      pool: db.pool!,
      secrets,
      config,
      webOrigin: "https://cadre.example",
      fetcher,
    });
  });
  afterAll(async () => {
    const member = await db.prisma.spaceMember.findFirst({ where: { userId } });
    if (member) await db.prisma.organization.delete({ where: { id: member.organizationId } });
    await db.prisma.user.delete({ where: { id: userId } });
    await db.prisma.$disconnect();
    await db.pool?.end();
  });
  async function start(actor = first) {
    const url = new URL(await service.start(actor, "session-one"));
    expect(url.origin).toBe(config.origin);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    challenge = url.searchParams.get("code_challenge")!;
    return new URLSearchParams({
      code: "test-code",
      state: url.searchParams.get("state")!,
      iss: config.origin,
    });
  }
  it("binds state to session and rejects replay", async () => {
    const params = await start();
    await expect(service.finish(userId, "other-session", params)).rejects.toThrow("expired");
    await expect(service.finish(userId, "session-one", params)).resolves.toBe(first.spaceId);
    await expect(service.finish(userId, "session-one", params)).rejects.toThrow("expired");
  });
  it("keeps two company grants separate under one Cadre account", async () => {
    company = "two";
    await service.finish(userId, "session-one", await start(second));
    expect((await service.credential(first))?.identity.company.id).toBe("one");
    expect((await service.credential(second))?.identity.company.id).toBe("two");
    expect(await service.list(userId)).toHaveLength(2);
    expect(JSON.stringify(await service.list(userId))).not.toMatch(
      /ciphertext|accessToken|refreshToken/,
    );
    const rows = await db.pool!.query(
      'SELECT ciphertext FROM company_workspace_grants WHERE "userId"=$1',
      [userId],
    );
    expect(rows.rows.every((row) => row.ciphertext.startsWith("v2:"))).toBe(true);
  });
  it("refuses changing the company of an existing workspace", async () => {
    company = "two";
    await expect(service.finish(userId, "session-one", await start(first))).rejects.toThrow(
      "separate workspace",
    );
    expect((await service.credential(first))?.identity.company.id).toBe("one");
  });
  it("rejects foreign accounts, issuer substitution, expired state and lost membership", async () => {
    subject = "other-account";
    await expect(service.finish(userId, "session-one", await start(first))).rejects.toThrow();
    subject = "company-account";
    const params = await start();
    params.set("iss", "https://other.example");
    await expect(service.finish(userId, "session-one", params)).rejects.toThrow("callback");
    params.set("iss", config.origin);
    await db.pool!.query(
      "UPDATE company_workspace_oauth_states SET \"expiresAt\"=NOW()-INTERVAL '1 minute' WHERE state=$1",
      [params.get("state")],
    );
    await expect(service.finish(userId, "session-one", params)).rejects.toThrow("expired");
    await expect(
      service.credential({ userId: "outsider", spaceId: first.spaceId }),
    ).rejects.toThrow();
    await expect(
      service.start({ userId, spaceId: "unowned-space" }, "session-one"),
    ).rejects.toThrow();
  });
  it("serializes refresh across competing runtimes and checks revocation/client identity", async () => {
    const row = await db.prisma.companyWorkspaceGrant.findUniqueOrThrow({
      where: { spaceId_userId: { spaceId: first.spaceId, userId } },
    });
    const material = JSON.parse(secrets.load(row.ciphertext, row.id));
    material.expiresAt = 0;
    const encrypted = await secrets.put(
      JSON.stringify(material),
      { ...first, operationId: "test", traceId: "test", signal: AbortSignal.timeout(10000) },
      row.id,
    );
    await db.prisma.companyWorkspaceGrant.update({
      where: { id: row.id },
      data: { ciphertext: encrypted.ciphertext },
    });
    await Promise.all([service.credential(first), service.credential(first)]);
    expect(refreshCount).toBe(1);
    revoked = true;
    await expect(service.credential(first)).rejects.toThrow("Reconnect");
    revoked = false;
    clientId = "another-client";
    await expect(service.credential(first)).rejects.toThrow();
    clientId = config.clientId;
  });
  it("attaches context to new bots and disables it after revoked authorization", async () => {
    const bot = await createRepos(db.prisma).createBot(first, {
      name: "Context worker",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const context = {
      ...first,
      botId: bot.id,
      operationId: "test",
      traceId: "test",
      signal: AbortSignal.timeout(10000),
    };
    await service.prepare(context);
    const server = await db.prisma.mcpServer.findUniqueOrThrow({
      where: {
        spaceId_userId_slug: { spaceId: first.spaceId, userId, slug: "company-os-context" },
      },
    });
    expect(server.enabled).toBe(true);
    expect(context).toHaveProperty("companyWorkspace", {
      id: "one",
      name: "Company one",
      slug: "one",
    });
    expect(
      await db.prisma.botMcpServer.count({
        where: { botId: bot.id, serverId: server.id, spaceId: first.spaceId },
      }),
    ).toBe(1);
    await expect(service.prepare({ ...context, spaceId: second.spaceId })).rejects.toThrow(
      "workspace bot",
    );
    revoked = true;
    await expect(service.prepare(context)).rejects.toThrow("Reconnect");
    expect(context).toHaveProperty("companyWorkspace", undefined);
    expect(
      (await db.prisma.mcpServer.findUniqueOrThrow({ where: { id: server.id } })).enabled,
    ).toBe(false);
    revoked = false;
  });
  it("refuses binding when membership is removed during the provider exchange", async () => {
    const space = await createSpaceForMember(db.prisma, {
      currentSpaceId: first.spaceId,
      userId,
      name: "Revoked during consent",
    });
    const actor = await requireMembership(db.prisma, userId, space.id);
    const params = await start(actor);
    removeMembershipOnIdentity = space.id;
    await expect(service.finish(userId, "session-one", params)).rejects.toThrow(
      "access was removed",
    );
    expect(await db.prisma.companyWorkspaceGrant.count({ where: { spaceId: space.id } })).toBe(0);
    expect(
      (await db.prisma.space.findUniqueOrThrow({ where: { id: space.id } })).companyOsCompanyId,
    ).toBeNull();
  });
  it("disconnects one workspace while retaining its binding and the other grant", async () => {
    await service.disconnect(first);
    expect(await service.credential(first)).toBeNull();
    expect((await service.credential(second))?.identity.company.id).toBe("two");
    company = "two";
    await expect(service.finish(userId, "session-one", await start(first))).rejects.toThrow(
      "separate workspace",
    );
  });
});
