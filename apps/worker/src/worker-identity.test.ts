import { describe, expect, it } from "vitest";
import { createWorkerIdentity } from "./worker-identity.js";

const revision = "a".repeat(40);
const uuid = /:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

describe("worker process identity", () => {
  it("separates workers from the same revision without relying on a container PID", () => {
    const identities = Array.from({ length: 32 }, () => createWorkerIdentity(revision));
    expect(new Set(identities.map((identity) => identity.id)).size).toBe(identities.length);
    for (const identity of identities) {
      expect(identity.revision).toBe(revision);
      expect(identity.id).toMatch(uuid);
      expect(identity.id.startsWith(`worker:${revision}:`)).toBe(true);
    }
  });

  it("normalizes an existing commit revision and supports SHA-256 repositories", () => {
    expect(createWorkerIdentity(`  ${revision.toUpperCase()}  `).revision).toBe(revision);
    expect(createWorkerIdentity("b".repeat(64)).revision).toBe("b".repeat(64));
    expect(createWorkerIdentity("abc1234").revision).toBe("abc1234");
  });

  it.each([
    undefined,
    "",
    "   ",
    "main",
    "abc123",
    "a".repeat(41),
    "a".repeat(65),
    "abc1234\nextra",
    "https://example.test/private",
  ])("omits missing or invalid revision text (%s)", (input) => {
    const identity = createWorkerIdentity(input);
    expect(identity.revision).toBeNull();
    expect(identity.id.startsWith("worker:unknown:")).toBe(true);
    expect(identity.id).toMatch(uuid);
  });
});
