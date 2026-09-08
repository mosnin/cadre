ALTER TABLE "user" ADD COLUMN "adminRole" TEXT NOT NULL DEFAULT 'member';
ALTER TABLE "user" ADD COLUMN "adminVerifiedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "billingCustomerId" TEXT;
CREATE UNIQUE INDEX "user_billingCustomerId_key" ON "user"("billingCustomerId");
ALTER TABLE "deployment_settings" ADD COLUMN "adminBootstrapConsumedAt" TIMESTAMP(3);
CREATE TABLE "admin_audit" (
  "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL,
  "targetId" TEXT, "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'completed',
  "requestId" TEXT NOT NULL UNIQUE, "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "admin_audit_createdAt_id_idx" ON "admin_audit"("createdAt", "id");
CREATE INDEX "admin_audit_actorId_createdAt_idx" ON "admin_audit"("actorId", "createdAt");
