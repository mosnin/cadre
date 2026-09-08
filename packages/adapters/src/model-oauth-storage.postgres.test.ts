import { randomUUID } from "node:crypto";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createDb } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { modelOAuthModifier } from "./model-oauth-storage.js";
import { PiRuntimeCredentialStore } from "./pi-credentials.js";
import { parseModelSecret } from "./pi-oauth.js";
import { EncryptedSecretStore } from "./secrets.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;
const expired: OAuthCredential = {
  type: "oauth",
  access: "expired",
  refresh: "old-refresh",
  expires: 1,
};

async function fixture() {
  const first = createDb(databaseUrl!);
  const second = createDb(databaseUrl!);
  const userId = randomUUID();
  const secretId = randomUUID();
  const secrets = new EncryptedSecretStore("synthetic-oauth-test-key");
  const scope = { userId, secretId, spaceId: "test-space", provider: "openai-codex" };
  await first.prisma.user.create({
    data: { id: userId, name: "OAuth test", email: `${userId}@example.test` },
  });
  const stored = await secrets.put(
    JSON.stringify(expired),
    {
      userId,
      spaceId: scope.spaceId,
      operationId: "test",
      traceId: "test",
      signal: new AbortController().signal,
    },
    secretId,
  );
  await first.prisma.secret.create({ data: { ...stored, userId, kind: "model" } });
  const credential = await first.prisma.userModelCredential.create({
    data: { userId, secretId, provider: scope.provider, label: "Test" },
  });
  return {
    first,
    second,
    secrets,
    scope,
    credential,
    async read() {
      const row = await first.prisma.secret.findUniqueOrThrow({ where: { id: secretId } });
      return parseModelSecret(secrets.load(row.ciphertext, row.id));
    },
    async close() {
      await first.prisma.user.delete({ where: { id: userId } });
      await Promise.all([first.prisma.$disconnect(), second.prisma.$disconnect()]);
      await Promise.all([first.pool.end(), second.pool.end()]);
    },
  };
}

describePostgres("model OAuth refresh across PostgreSQL clients", () => {
  it("refreshes once for two independent Pi runtimes with stale token snapshots", async () => {
    const f = await fixture();
    const access = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" } })).toString("base64url")}.test`;
    const refresh = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(
        JSON.stringify({ access_token: access, refresh_token: "rotated", expires_in: 3600 }),
      );
    });
    vi.stubGlobal("fetch", refresh);
    try {
      const runtimes = [f.first, f.second].map(({ prisma }) =>
        builtinModels({
          credentials: new PiRuntimeCredentialStore(
            "openai-codex",
            { ...expired },
            undefined,
            modelOAuthModifier(prisma, f.secrets, f.scope),
          ),
        }),
      );
      const result = await Promise.all(runtimes.map((runtime) => runtime.getAuth("openai-codex")));
      expect(result.map((item) => item?.auth.apiKey)).toEqual([access, access]);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(await f.read()).toMatchObject({ kind: "oauth", credential: { refresh: "rotated" } });
    } finally {
      vi.unstubAllGlobals();
      await f.close();
    }
  });

  it("never refreshes a credential replaced after the runtime was created", async () => {
    const f = await fixture();
    const modify = modelOAuthModifier(f.second.prisma, f.secrets, f.scope);
    const update = vi.fn(async () => expired);
    try {
      await f.first.prisma.userModelCredential.update({
        where: { id: f.credential.id },
        data: { secretId: "replacement" },
      });
      await expect(modify(update)).rejects.toThrow("Model connection changed");
      expect(update).not.toHaveBeenCalled();
      expect(await f.read()).toMatchObject({ credential: expired });
    } finally {
      await f.close();
    }
  });

  it("persists a completed rotation even if its run is cancelled while refreshing", async () => {
    const f = await fixture();
    const controller = new AbortController();
    try {
      const modify = modelOAuthModifier(f.first.prisma, f.secrets, f.scope);
      await modify(async (current) => {
        controller.abort();
        return { ...current, access: "fresh", refresh: "rotated", expires: Date.now() + 3600_000 };
      }, controller.signal);
      expect(await f.read()).toMatchObject({ credential: { refresh: "rotated" } });
    } finally {
      await f.close();
    }
  });

  it("does not refresh after cancellation while another worker holds the row lock", async () => {
    const f = await fixture();
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new AbortController();
    const update = vi.fn(async () => expired);
    const first = modelOAuthModifier(
      f.first.prisma,
      f.secrets,
      f.scope,
    )(async () => {
      entered();
      await releasePromise;
      return undefined;
    });
    try {
      await enteredPromise;
      const second = modelOAuthModifier(
        f.second.prisma,
        f.secrets,
        f.scope,
      )(update, controller.signal);
      const rejected = expect(second).rejects.toThrow();
      controller.abort();
      release();
      await first;
      await rejected;
      expect(update).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
      await f.close();
    }
  });

  it("rejects a different user's scope before invoking the refresh callback", async () => {
    const f = await fixture();
    const update = vi.fn(async () => expired);
    try {
      await expect(
        modelOAuthModifier(f.second.prisma, f.secrets, { ...f.scope, userId: "another-user" })(
          update,
        ),
      ).rejects.toThrow("Model connection changed");
      expect(update).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});
