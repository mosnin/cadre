import { verifyWorkforceRequest, workforceIdentity } from "@rakazo/core/node/workforce-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertChippiAuthority, queryChippiCrm } from "./chippi-authority.js";

const secret = "test-only-authority-".repeat(4);
const principal = {
  actorId: "synthetic-user",
  scopeId: "synthetic-scope",
  kind: "brokerage" as const,
  role: "admin" as const,
  name: "Synthetic brokerage",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("background execution reauthorization", () => {
  it("rejects copied authority for a different workspace before contacting the host", async () => {
    vi.stubEnv("CHIPPI_WORKFORCE_SECRET", secret);
    vi.stubEnv("CHIPPI_APP_ORIGIN", "https://crm.example");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(assertChippiAuthority(principal, "another-space")).rejects.toThrow("mismatch");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed for revoked membership and signs the exact request", async () => {
    vi.stubEnv("CHIPPI_WORKFORCE_SECRET", secret);
    vi.stubEnv("CHIPPI_APP_ORIGIN", "https://crm.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      assertChippiAuthority(principal, workforceIdentity(principal).spaceId),
    ).rejects.toThrow("revoked");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url.toString()).toBe("https://crm.example/api/internal/workforce/authorize");
    expect(
      verifyWorkforceRequest(
        secret,
        init.headers["x-chippi-authorization"],
        "POST",
        url.pathname,
        init.body,
      ).principal,
    ).toEqual(principal);
    expect(init.redirect).toBe("error");
  });
  it("allows unchanged live membership and leaves standalone deployments unchanged", async () => {
    vi.stubEnv("CHIPPI_WORKFORCE_SECRET", secret);
    vi.stubEnv("CHIPPI_APP_ORIGIN", "https://crm.example");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      assertChippiAuthority(principal, workforceIdentity(principal).spaceId),
    ).resolves.toBeUndefined();
    vi.stubEnv("CHIPPI_WORKFORCE_SECRET", "");
    await expect(assertChippiAuthority(null, "standalone")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("binds team mutations to the exact signed payload and current execution authority", async () => {
  vi.stubEnv("CHIPPI_WORKFORCE_SECRET", secret);
  vi.stubEnv("CHIPPI_APP_ORIGIN", "https://crm.example");
  const team = { ...principal, kind: "team" as const };
  const args = {
    operation: "action",
    tool: "create_team_work",
    args: { requestId: "10000000-0000-4000-8000-000000000001", title: "Synthetic work" },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ item: { id: "receipt" } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await queryChippiCrm(team, workforceIdentity(team).spaceId, args, new AbortController().signal),
  ).toEqual({ item: { id: "receipt" } });
  const [url, init] = fetchMock.mock.calls[1]!;
  expect(url.pathname).toBe("/api/internal/workforce/crm");
  expect(JSON.parse(init.body.toString())).toEqual(args);
  expect(
    verifyWorkforceRequest(
      secret,
      init.headers["x-chippi-authorization"],
      "POST",
      url.pathname,
      init.body,
    ).principal,
  ).toEqual(team);
});
