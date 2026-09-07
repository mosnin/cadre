import { randomUUID } from "node:crypto";
import {
  signWorkforceRequest,
  type WorkforcePrincipal,
  workforceIdentity,
} from "@rakazo/core/node/workforce-auth";
import { createDb, ensureChippi, withWorkforceAuthority } from "@rakazo/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountChippiHost } from "./chippi-host.js";

const databaseUrl = process.env.CHIPPI_TEST_DATABASE_URL;
const local = databaseUrl && ["127.0.0.1", "localhost"].includes(new URL(databaseUrl).hostname);
describe.skipIf(!local)("Chippi host with real isolated Postgres", () => {
  const secret = "test-only-bridge-".repeat(4);
  const principal: WorkforcePrincipal = {
    actorId: "test-actor",
    kind: "personal",
    scopeId: randomUUID(),
    name: "Synthetic test workspace",
    role: "owner",
  };
  let db: ReturnType<typeof createDb>;
  let app: Hono;
  const request = (path: string, token?: string) =>
    app.request(path, {
      headers: token
        ? {
            "x-chippi-authorization": token,
            "x-chippi-actor": "forged",
            "x-rakazo-space-id": "forged",
          }
        : {},
    });
  const sign = (path: string) =>
    signWorkforceRequest(secret, principal, "GET", path, Buffer.alloc(0));
  beforeAll(() => {
    db = createDb(databaseUrl!);
    app = new Hono();
    mountChippiHost(app, db.prisma, secret);
    app.get("/rpc/probe", (c) =>
      c.json({ user: c.req.header("x-chippi-actor"), space: c.req.header("x-rakazo-space-id") }),
    );
  });
  afterAll(async () => {
    const { spaceId, userId } = workforceIdentity(principal);
    await db.prisma.organization.deleteMany({ where: { id: spaceId } });
    await db.prisma.user.deleteMany({ where: { id: userId } });
    await db.prisma.$disconnect();
    await db.pool.end();
  });
  it("provisions concurrently on first access", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request("/rpc/probe", sign("/rpc/probe"))),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    expect(
      await db.prisma.bot.count({
        where: { spaceId: workforceIdentity(principal).spaceId, systemRole: "chippi" },
      }),
    ).toBe(1);
  });
  it("refuses direct access and replay, replaces forged actor/scope", async () => {
    expect((await request("/rpc/probe")).status).toBe(401);
    const token = sign("/rpc/probe");
    const response = await request("/rpc/probe", token);
    expect(response.status).toBe(200);
    const identity = workforceIdentity(principal);
    expect(await response.json()).toEqual({ user: identity.userId, space: identity.spaceId });
    expect((await request("/rpc/probe", token)).status).toBe(403);
  });
  it("provisions exactly one Chippi concurrently and rejects raw database mutations", async () => {
    const identity = workforceIdentity(principal);
    const actor = {
      ...identity,
      email: `${identity.userId}@workforce.invalid`,
      isDeploymentOwner: false,
    };
    const ids = await Promise.all(Array.from({ length: 5 }, () => ensureChippi(db.prisma, actor)));
    expect(new Set(ids).size).toBe(1);
    const id = ids[0]!;
    expect(
      await db.prisma.bot.count({ where: { spaceId: identity.spaceId, systemRole: "chippi" } }),
    ).toBe(1);
    for (const data of [
      { name: "Other" },
      { pinned: false },
      { archivedAt: new Date() },
      { systemRole: null },
      { userId: "someone-else" },
    ])
      await expect(db.prisma.bot.update({ where: { id }, data })).rejects.toThrow();
    await expect(db.prisma.bot.delete({ where: { id } })).rejects.toThrow();
    await expect(
      db.prisma.bot.update({
        where: { id },
        data: { instructions: "New authorized instructions" },
      }),
    ).resolves.toMatchObject({ name: "Chippi" });
  });
  it("rejects a reserved identity with a null system role", async () => {
    const identity = workforceIdentity(principal);
    await expect(
      db.prisma.bot.create({
        data: {
          id: `chippi_${"f".repeat(64)}`,
          spaceId: identity.spaceId,
          userId: identity.userId,
          name: "Chippi",
          pinned: true,
          color: "synthetic",
          systemRole: null,
        },
      }),
    ).rejects.toThrow();
  });
  it("persists routine authority across transaction boundaries and refuses unbound work", async () => {
    const identity = workforceIdentity(principal);
    const bot = await db.prisma.bot.findFirstOrThrow({
      where: { spaceId: identity.spaceId, systemRole: "chippi" },
    });
    const data = {
      spaceId: identity.spaceId,
      userId: identity.userId,
      botId: bot.id,
      name: "Synthetic routine",
      prompt: "Read local test data",
      crons: ["0 9 * * *"],
    };
    const previous = process.env.CHIPPI_WORKFORCE_SECRET;
    process.env.CHIPPI_WORKFORCE_SECRET = secret;
    try {
      await expect(db.prisma.routine.create({ data })).rejects.toThrow(
        "Missing Chippi routine authority",
      );
      const routine = await withWorkforceAuthority(principal, () =>
        db.prisma.$transaction((tx) => tx.routine.create({ data })),
      );
      expect(routine.workforceAuthority).toEqual(principal);
      expect(
        (await db.prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }))
          .workforceAuthority,
      ).toEqual(principal);
    } finally {
      if (previous === undefined) delete process.env.CHIPPI_WORKFORCE_SECRET;
      else process.env.CHIPPI_WORKFORCE_SECRET = previous;
    }
  });
  it("returns a host session without issuing a second account credential", async () => {
    const response = await request("/api/auth/get-session", sign("/api/auth/get-session"));
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect((await response.json()).user.name).toBe(principal.name);
    expect((await request("/api/auth/sign-up/email", sign("/api/auth/sign-up/email"))).status).toBe(
      403,
    );
  });
});
