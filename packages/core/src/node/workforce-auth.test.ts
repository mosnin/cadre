import { describe, expect, it } from "vitest";
import {
  readWorkforceBody,
  signWorkforceRequest,
  verifyWorkforceRequest,
  type WorkforcePrincipal,
  workforceIdentity,
} from "./workforce-auth.js";

const secret = "test-only-workforce-secret-".repeat(3);
const principal: WorkforcePrincipal = {
  actorId: "user-a",
  kind: "personal",
  scopeId: "scope-a",
  name: "Test workspace",
  role: "owner",
};
const body = Buffer.from('{"task":"test"}');
describe("workforce request authority", () => {
  it("binds method, exact path, body, expiry and tenant", () => {
    const token = signWorkforceRequest(secret, principal, "POST", "/rpc/test?x=1", body, 100000);
    expect(
      verifyWorkforceRequest(secret, token, "POST", "/rpc/test?x=1", body, 100000).principal,
    ).toEqual(principal);
    for (const [method, path, bytes, now] of [
      ["GET", "/rpc/test?x=1", body, 100000],
      ["POST", "/rpc/test?x=2", body, 100000],
      ["POST", "/rpc/test?x=1", Buffer.from("changed"), 100000],
      ["POST", "/rpc/test?x=1", body, 130000],
    ] as const)
      expect(() => verifyWorkforceRequest(secret, token, method, path, bytes, now)).toThrow();
    expect(() =>
      verifyWorkforceRequest(secret + "other", token, "POST", "/rpc/test?x=1", body, 100000),
    ).toThrow();
    const parts = token.split(".");
    const tampered = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    tampered.principal.scopeId = "victim";
    expect(() =>
      verifyWorkforceRequest(
        secret,
        Buffer.from(JSON.stringify(tampered)).toString("base64url") + "." + parts[1],
        "POST",
        "/rpc/test?x=1",
        body,
        100000,
      ),
    ).toThrow();
  });
  it("separates scope kinds and keeps org workers stable across human admins", () => {
    expect(workforceIdentity(principal)).toEqual(
      workforceIdentity({ ...principal, actorId: "another" } as WorkforcePrincipal),
    );
    expect(workforceIdentity(principal)).not.toEqual(
      workforceIdentity({ ...principal, kind: "brokerage" }),
    );
  });
  it("isolates owner browser credentials from administrators", () => {
    expect(workforceIdentity({ ...principal, kind: "brokerage", role: "owner" })).not.toEqual(
      workforceIdentity({ ...principal, kind: "brokerage", role: "admin" }),
    );
  });
  it("bounds a chunked request without trusting content-length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readWorkforceBody(request, 10)).rejects.toThrow("Request too large");
  });
  it("rejects missing, malformed and oversized signatures", () => {
    for (const token of ["", ".", "x.y.z", "x".repeat(9000)])
      expect(() => verifyWorkforceRequest(secret, token, "GET", "/", Buffer.alloc(0))).toThrow();
  });
});
