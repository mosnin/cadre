import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeSandboxProvider } from "@rakazo/adapters";
import type { BillingSnapshot } from "@rakazo/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "./index.js";

const withDb =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;
withDb("platform administration security", () => {
  let handles: Awaited<ReturnType<typeof import("../../../apps/api/src/app.js").createApp>>;
  const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const adminEmail = `admin-${stamp}@example.test`;
  const code = "offline-bootstrap-code-not-a-production-secret";
  const dataDir = mkdtempSync(path.join(tmpdir(), "cadre-admin-"));
  let adminCookie: string;
  let memberCookie: string;
  let adminId: string;
  let memberId: string;
  const customer = vi.fn();
  const setCancellation = vi.fn();

  async function raw(cookie: string, method: string, input: unknown = {}) {
    return handles.app.request(`/rpc/${method}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ json: input }),
    });
  }
  async function rpc<T = any>(cookie: string, method: string, input: unknown = {}): Promise<T> {
    const response = await raw(cookie, method, input);
    const body = (await response.json()) as { json: T };
    expect(response.status, `${method}: ${JSON.stringify(body)}`).toBe(200);
    return body.json;
  }
  async function signup(email: string, extra: Record<string, unknown> = {}) {
    const response = await handles.app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ name: "Admin fixture", email, password: "password12", ...extra }),
    });
    expect(response.status).toBe(200);
    return sessionCookieHeader(response);
  }
  const input = (extra: Record<string, unknown>) => ({
    requestId: randomUUID(),
    reason: "Offline administration test",
    ...extra,
  });

  beforeAll(async () => {
    const { createApp } = await import("../../../apps/api/src/app.js");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      adminEmails: adminEmail,
      adminBootstrapTokenHash: createHash("sha256").update(code).digest("hex"),
      billing: { customer, setCancellation },
    });
    adminCookie = await signup(adminEmail);
    memberCookie = await signup(`member-${stamp}@example.test`, {
      adminRole: "admin",
      adminVerifiedAt: new Date().toISOString(),
      emailVerified: true,
    });
    adminId = (await rpc(adminCookie, "me")).userId;
    memberId = (await rpc(memberCookie, "me")).userId;
  });
  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("does not trust role or verification fields submitted during signup", async () => {
    expect(await handles.prisma.user.findUniqueOrThrow({ where: { id: memberId } })).toMatchObject({
      adminRole: "member",
      adminVerifiedAt: null,
      emailVerified: false,
    });
    expect(await rpc(memberCookie, "admin/status")).toMatchObject({
      allowed: false,
      canClaim: false,
    });
    expect((await raw(memberCookie, "admin/users")).status).toBe(403);
    expect((await raw("", "admin/users")).status).toBe(401);
  });

  it("binds one-time bootstrap to the configured authenticated account", async () => {
    expect(await rpc(adminCookie, "admin/status")).toMatchObject({
      allowed: false,
      canClaim: true,
      needsClaimCode: true,
    });
    expect((await raw(memberCookie, "admin/claim", { code, requestId: randomUUID() })).status).toBe(
      403,
    );
    expect(
      (await raw(adminCookie, "admin/claim", { code: "wrong", requestId: randomUUID() })).status,
    ).toBe(403);
    await rpc(adminCookie, "admin/claim", { code, requestId: randomUUID() });
    expect(await rpc(adminCookie, "admin/status")).toMatchObject({ allowed: true });
    expect((await raw(adminCookie, "admin/claim", { code, requestId: randomUUID() })).status).toBe(
      403,
    );
    const audit = await handles.prisma.adminAudit.findMany({ where: { actorId: adminId } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(code);
  });

  it("requires recent authentication for changes while allowing reads", async () => {
    await handles.prisma.session.updateMany({
      where: { userId: adminId },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    try {
      await rpc(adminCookie, "admin/users");
      expect(
        (await raw(adminCookie, "admin/userAction", input({ userId: memberId, action: "suspend" })))
          .status,
      ).toBe(403);
    } finally {
      await handles.prisma.session.updateMany({
        where: { userId: adminId },
        data: { createdAt: new Date() },
      });
    }
  });

  it("protects the bootstrap administrator and requires verified email for additional admins", async () => {
    for (const action of ["suspend", "demote"])
      expect(
        (await raw(adminCookie, "admin/userAction", input({ userId: adminId, action }))).status,
      ).toBe(403);
    expect(
      (await raw(adminCookie, "admin/userAction", input({ userId: memberId, action: "promote" })))
        .status,
    ).toBe(400);
    expect(
      (await raw(memberCookie, "admin/userAction", input({ userId: memberId, action: "promote" })))
        .status,
    ).toBe(403);
  });

  it("deduplicates mutations and rejects a request ID reused for different work", async () => {
    const request = input({ userId: memberId, action: "pause_schedules" });
    await Promise.all([
      rpc(adminCookie, "admin/userAction", request),
      rpc(adminCookie, "admin/userAction", request),
    ]);
    expect(await handles.prisma.adminAudit.count({ where: { requestId: request.requestId } })).toBe(
      1,
    );
    expect(
      (await raw(adminCookie, "admin/userAction", { ...request, action: "suspend" })).status,
    ).toBe(409);
  });

  it("does not expose session tokens or connection secrets in admin detail", async () => {
    const me = await rpc(memberCookie, "me");
    await handles.prisma.connection.create({
      data: {
        spaceId: me.spaceId,
        userId: memberId,
        provider: "fixture",
        displayName: "Fixture",
        status: "connected",
        providerRef: "private-provider-ref",
        metadata: { credential: "private-connector-value" },
      },
    });
    const result = await rpc(adminCookie, "admin/user", { userId: memberId });
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(Object.keys(result.sessions[0]).sort()).toEqual(["createdAt", "expiresAt", "id"]);
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider-ref|private-connector-value|ciphertext|password/,
    );
  });

  it("suspends login, existing sessions, scheduled work, and newly queued agent work", async () => {
    const me = await rpc(memberCookie, "me");
    const bot = await rpc(memberCookie, "bots/create", {
      name: "Suspension fixture",
      title: "",
      description: "",
      notifyOnFinish: false,
    });
    const thread = await handles.prisma.thread.findFirstOrThrow({ where: { botId: bot.id } });
    const routine = await handles.prisma.routine.create({
      data: {
        spaceId: me.spaceId,
        userId: memberId,
        botId: bot.id,
        threadId: thread.id,
        name: "Fixture schedule",
        prompt: "Check",
        crons: ["0 9 * * *"],
        active: true,
        nextRunAt: new Date(Date.now() + 86400_000),
      },
    });
    await rpc(adminCookie, "admin/userAction", input({ userId: memberId, action: "suspend" }));
    expect((await raw(memberCookie, "me")).status).toBe(401);
    const login = await handles.app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email: `member-${stamp}@example.test`, password: "password12" }),
    });
    expect(login.status).toBe(403);
    expect(
      await handles.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }),
    ).toMatchObject({ active: false, nextRunAt: null });
    const task = await handles.prisma.task.create({
      data: {
        spaceId: me.spaceId,
        userId: memberId,
        botId: bot.id,
        threadId: thread.id,
        prompt: "late webhook",
        status: "queued",
      },
    });
    const run = await handles.prisma.run.create({
      data: {
        spaceId: me.spaceId,
        userId: memberId,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        status: "queued",
        trigger: "webhook",
      },
    });
    const provision = vi.spyOn(FakeSandboxProvider.prototype, "provision");
    try {
      await handles.executor.continueRun(run.id, "fixture-worker");
      expect(provision).not.toHaveBeenCalled();
    } finally {
      provision.mockRestore();
    }
    expect(await handles.prisma.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "cancelled",
    });
    expect(
      (
        await raw(
          adminCookie,
          "admin/scheduleAction",
          input({ routineId: routine.id, active: true }),
        )
      ).status,
    ).toBe(403);
    await rpc(adminCookie, "admin/userAction", input({ userId: memberId, action: "reactivate" }));
    expect(
      await handles.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }),
    ).toMatchObject({ active: false });
  });

  it("binds billing to the user's customer and records uncertain provider writes", async () => {
    const snapshot: BillingSnapshot = {
      customerId: "cus_fixture",
      email: "wrong@example.test",
      dashboardUrl: "https://dashboard.stripe.com/test/customers/cus_fixture",
      subscriptions: [],
      invoices: [],
    };
    customer.mockResolvedValue(snapshot);
    expect(
      (
        await raw(
          adminCookie,
          "admin/linkBilling",
          input({ userId: memberId, customerId: "cus_fixture" }),
        )
      ).status,
    ).toBe(400);
    customer.mockResolvedValue({ ...snapshot, email: `member-${stamp}@example.test` });
    await rpc(
      adminCookie,
      "admin/linkBilling",
      input({ userId: memberId, customerId: "cus_fixture" }),
    );
    setCancellation.mockRejectedValueOnce(new Error("provider disconnected"));
    const request = input({
      userId: memberId,
      subscriptionId: "sub_fixture",
      cancelAtPeriodEnd: true,
    });
    expect((await raw(adminCookie, "admin/updateSubscription", request)).status).toBe(502);
    expect((await raw(adminCookie, "admin/updateSubscription", request)).status).toBe(409);
    expect(setCancellation).toHaveBeenCalledTimes(1);
    expect(
      await handles.prisma.adminAudit.findUniqueOrThrow({
        where: { requestId: request.requestId },
      }),
    ).toMatchObject({ status: "unknown" });
  });
});
