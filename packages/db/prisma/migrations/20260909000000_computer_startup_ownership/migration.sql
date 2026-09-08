ALTER TABLE "computers"
ADD COLUMN "workspaceRestorePending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "startupOperationId" TEXT,
ADD COLUMN "startupExpiresAt" TIMESTAMP(3),
ADD COLUMN "startupRequestedAt" TIMESTAMP(3),
ADD COLUMN "startupBotId" TEXT,
ADD COLUMN "startupAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "computers_state_startupExpiresAt_idx" ON "computers"("state", "startupExpiresAt");
