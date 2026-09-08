import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type WorkforcePrincipal = {
  actorId: string;
  kind: "personal" | "brokerage" | "team";
  scopeId: string;
  name: string;
  routeId?: string;
  role: "owner" | "admin" | "member";
};
export function workforceIdentity(
  principal: Pick<WorkforcePrincipal, "kind" | "scopeId" | "role">,
) {
  const hash = createHash("sha256")
    .update(
      `${principal.kind}:${principal.scopeId}:${principal.kind === "brokerage" ? principal.role : "owner"}`,
    )
    .digest("hex");
  return { spaceId: `wf_${hash}`, userId: `wf_owner_${hash}` };
}
export function signWorkforceRequest(
  secret: string,
  principal: WorkforcePrincipal,
  method: string,
  path: string,
  body: Uint8Array,
  now = Date.now(),
) {
  if (secret.length < 32)
    throw new Error("Workforce signing key must contain at least 32 characters");
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      aud: "chippi-workforce",
      principal,
      method,
      path,
      digest: createHash("sha256").update(body).digest("hex"),
      exp: Math.floor(now / 1000) + 30,
      nonce: randomUUID(),
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export function verifyWorkforceRequest(
  secret: string,
  token: string,
  method: string,
  path: string,
  body: Uint8Array,
  now = Date.now(),
): { principal: WorkforcePrincipal; nonce: string; expiresAt: Date } {
  if (secret.length < 32 || token.length > 8192) throw new Error("Invalid workforce request");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid workforce request");
  const expected = createHmac("sha256", secret).update(parts[0]!).digest();
  const actual = Buffer.from(parts[1]!, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual))
    throw new Error("Invalid workforce request");
  const data = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
  const p = data.principal;
  if (
    (p?.routeId !== undefined &&
      (typeof p.routeId !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(p.routeId))) ||
    data.v !== 1 ||
    data.aud !== "chippi-workforce" ||
    data.method !== method ||
    data.path !== path ||
    data.digest !== createHash("sha256").update(body).digest("hex") ||
    !Number.isInteger(data.exp) ||
    data.exp <= Math.floor(now / 1000) ||
    data.exp > Math.floor(now / 1000) + 30 ||
    typeof data.nonce !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.nonce) ||
    !p ||
    !["personal", "brokerage", "team"].includes(p.kind) ||
    !["owner", "admin", "member"].includes(p.role) ||
    (p.role === "member" && p.kind !== "team") ||
    ![p.actorId, p.scopeId, p.name].every(
      (x) => typeof x === "string" && x.length > 0 && x.length <= 200,
    )
  )
    throw new Error("Invalid workforce request");
  return { principal: p, nonce: data.nonce, expiresAt: new Date(data.exp * 1000) };
}

/** Read incrementally so chunked requests cannot bypass the body limit. */
export async function readWorkforceBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new RangeError("Request too large");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new RangeError("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
