ALTER TABLE "connections" ADD COLUMN "userRevoked" BOOLEAN NOT NULL DEFAULT false;

-- Older revocations did not record intent. Preserve them until an explicit new connection.
UPDATE "connections" SET "userRevoked" = true WHERE status = 'revoked';
