import {
  signWorkforceRequest,
  type WorkforcePrincipal,
  workforceIdentity,
} from "@rakazo/core/node/workforce-auth";
export async function assertChippiAuthority(value: unknown, spaceId: string): Promise<void> {
  const secret = process.env.CHIPPI_WORKFORCE_SECRET;
  if (!secret) return;
  const origin = process.env.CHIPPI_APP_ORIGIN;
  if (!origin || !value || typeof value !== "object")
    throw new Error("Chippi execution authority unavailable");
  const principal = value as WorkforcePrincipal;
  if (workforceIdentity(principal).spaceId !== spaceId)
    throw new Error("Chippi workspace authority mismatch");
  const target = new URL("/api/internal/workforce/authorize", origin);
  if (
    target.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && ["127.0.0.1", "localhost"].includes(target.hostname))
  )
    throw new Error("Invalid Chippi origin");
  const body = Buffer.from(JSON.stringify(principal));
  const response = await fetch(target, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-chippi-authorization": signWorkforceRequest(
        secret,
        principal,
        "POST",
        target.pathname,
        body,
      ),
    },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 204) throw new Error("Chippi execution authority revoked or unavailable");
}

export async function queryChippiCrm(
  value: unknown,
  spaceId: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  await assertChippiAuthority(value, spaceId);
  const secret = process.env.CHIPPI_WORKFORCE_SECRET;
  const origin = process.env.CHIPPI_APP_ORIGIN;
  if (!secret || !origin) throw new Error("Chippi CRM is not configured");
  const principal = value as WorkforcePrincipal;
  const target = new URL("/api/internal/workforce/crm", origin);
  const body = Buffer.from(JSON.stringify(args));
  const response = await fetch(target, {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-chippi-authorization": signWorkforceRequest(
        secret,
        principal,
        "POST",
        target.pathname,
        body,
      ),
    },
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  if (!response.ok) return { error: "CRM query unavailable or outside the current workspace" };
  return response.json();
}
