import {
  readWorkforceBody,
  verifyWorkforceRequest,
  type WorkforcePrincipal,
  workforceIdentity,
} from "@rakazo/core/node/workforce-auth";
import {
  currentWorkforceAuthority,
  ensureChippi,
  type PrismaClient,
  withWorkforceAuthority,
} from "@rakazo/db";
import type { Hono } from "hono";

async function provision(prisma: PrismaClient, principal: WorkforcePrincipal) {
  const { spaceId, userId } = workforceIdentity(principal);
  const email = `${userId}@workforce.invalid`;
  const actor = { spaceId, userId, email, isDeploymentOwner: false };
  const existing = await prisma.bot.findFirst({
    where: { spaceId, userId, systemRole: "chippi" },
    select: { id: true },
  });
  if (existing) return actor;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${spaceId}))`;
    await tx.user.upsert({
      where: { id: userId },
      create: { id: userId, name: principal.name, email, emailVerified: true },
      update: {},
    });
    await tx.organization.upsert({
      where: { id: spaceId },
      create: { id: spaceId, name: principal.name, slug: spaceId, createdAt: new Date() },
      update: {},
    });
    await tx.member.upsert({
      where: { organizationId_userId: { organizationId: spaceId, userId } },
      create: {
        id: `${spaceId}_owner`,
        organizationId: spaceId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
      update: {},
    });
    await tx.space.upsert({
      where: { id: spaceId },
      create: {
        id: spaceId,
        organizationId: spaceId,
        name: principal.name,
        isDefault: true,
        createdByUserId: userId,
      },
      update: {},
    });
    await tx.spaceMember.upsert({
      where: { spaceId_userId: { spaceId, userId } },
      create: {
        id: `${spaceId}_member`,
        spaceId,
        organizationId: spaceId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
      update: {},
    });
  });
  await ensureChippi(prisma, actor);
  return actor;
}

/** Only installed on a dedicated Chippi runtime. Every request is signed by the CRM server. */
export function mountChippiHost(app: Hono, prisma: PrismaClient, secret: string) {
  app.use("*", async (c, next) => {
    // Health contains no customer data and remains useful to an operator.
    if (new URL(c.req.url).pathname === "/health") return next();
    const token = c.req.header("x-chippi-authorization");
    if (!token) return c.json({ error: "Unauthorized" }, 401);
    let principalForWork: WorkforcePrincipal | undefined;
    try {
      const url = new URL(c.req.url);
      const bytes = await readWorkforceBody(c.req.raw.clone(), 16 * 1024 * 1024);
      const { principal, nonce, expiresAt } = verifyWorkforceRequest(
        secret,
        token,
        c.req.method,
        url.pathname + url.search,
        bytes,
      );
      await prisma.workforceRequestNonce.create({ data: { id: nonce, expiresAt } });
      await prisma.workforceRequestNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const actor = await provision(prisma, principal);
      principalForWork = principal;
      // No browser-controlled scope, auth cookie, or role is trusted downstream.
      c.req.raw.headers.delete("cookie");
      c.req.raw.headers.delete("authorization");
      c.req.raw.headers.set("x-rakazo-space-id", actor.spaceId);
      c.req.raw.headers.set("x-chippi-actor", actor.userId);
      if (url.pathname === "/api/auth/get-session")
        return c.json(
          {
            session: { id: nonce, userId: actor.userId, expiresAt: expiresAt.toISOString() },
            user: {
              id: actor.userId,
              name: principal.name,
              email: actor.email,
              emailVerified: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          200,
          { "Cache-Control": "no-store" },
        );
      if (url.pathname === "/api/auth/capabilities")
        return c.json({
          provider: "chippi",
          hosted: true,
          companyOsOrigin: null,
          passwordReset: false,
          resetUrl: null,
        });
      if (url.pathname.startsWith("/api/auth/"))
        return c.json({ error: "Manage your account in Chippi" }, 403);
    } catch (error) {
      if (error instanceof RangeError) return c.json({ error: "Request too large" }, 413);
      return c.json({ error: "Workforce authorization unavailable" }, 403);
    }
    return withWorkforceAuthority(principalForWork, () => next());
  });
}

/** OAuth returns to the same authenticated workspace rather than a second login page. */
export function chippiWebUrl(origin: string, path: string): string {
  const principal = currentWorkforceAuthority();
  const base =
    process.env.CHIPPI_WORKFORCE_SECRET && principal
      ? `/workforce/${principal.kind}/${encodeURIComponent(principal.routeId ?? principal.scopeId)}`
      : "";
  return new URL(base + path, origin).toString();
}
