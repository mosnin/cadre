import type { ModifyModelOAuthCredential } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { toOAuthCredential } from "./pi-credentials.js";
import { parseModelSecret, serializeModelSecret } from "./pi-oauth.js";
import type { EncryptedSecretStore } from "./secrets.js";

/** The lock spans upstream refresh and encrypted persistence, across all workers. */
export function modelOAuthModifier(
  prisma: PrismaClient,
  secrets: EncryptedSecretStore,
  scope: { userId: string; spaceId: string; secretId: string; provider: string },
  registerSecrets?: (values: string[]) => void,
): ModifyModelOAuthCredential {
  return async (update, signal) => {
    signal?.throwIfAborted();
    return prisma.$transaction(
      async (tx) => {
        // Leave enough transaction time for the bounded provider refresh after
        // contention; never rotate a token just as the database deadline expires.
        await tx.$executeRaw`SET LOCAL lock_timeout = '15s'`;
        await tx.$queryRaw`SELECT id FROM secrets WHERE id = ${scope.secretId} AND "userId" = ${scope.userId} AND "spaceId" IS NULL FOR UPDATE`;
        signal?.throwIfAborted();
        const [row, credential] = await Promise.all([
          tx.secret.findFirst({
            where: { id: scope.secretId, userId: scope.userId, spaceId: null },
          }),
          tx.userModelCredential.findFirst({
            where: { userId: scope.userId, provider: scope.provider, secretId: scope.secretId },
          }),
        ]);
        if (!row || !credential) throw new Error("Model connection changed. Start the task again.");
        const current = parseModelSecret(secrets.load(row.ciphertext, row.id));
        if (current.kind !== "oauth")
          throw new Error("Model connection changed. Start the task again.");
        registerSecrets?.([current.credential.access, current.credential.refresh]);
        const next = await update(current.credential);
        // Once the provider rotates a refresh token, persist it even if the run was
        // cancelled meanwhile. Leaving the old token would break the next run.
        if (next && JSON.stringify(next) !== JSON.stringify(current.credential)) {
          registerSecrets?.([next.access, next.refresh]);
          const stored = await secrets.put(
            serializeModelSecret({ kind: "oauth", credential: toOAuthCredential(next) }),
            {
              operationId: "cred",
              traceId: "cred-refresh",
              userId: scope.userId,
              spaceId: scope.spaceId,
              signal: new AbortController().signal,
            },
            row.id,
          );
          await tx.secret.update({
            where: { id: row.id },
            data: { ciphertext: stored.ciphertext },
          });
        }
        return next ?? current.credential;
      },
      { maxWait: 10_000, timeout: 75_000 },
    );
  };
}
