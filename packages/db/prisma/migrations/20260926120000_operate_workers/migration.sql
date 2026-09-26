-- A member picks one bot to work the tasks assigned to their Operate agent;
-- each claimed task is tracked until its outcome is written back to Operate.

-- CreateTable
CREATE TABLE "operate_workers" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operate_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operate_assignments" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "operateRunId" TEXT,
    "runId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operate_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operate_workers_botId_key" ON "operate_workers"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "operate_workers_spaceId_userId_key" ON "operate_workers"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "operate_assignments_workerId_reported_idx" ON "operate_assignments"("workerId", "reported");

-- AddForeignKey
ALTER TABLE "operate_workers" ADD CONSTRAINT "operate_workers_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operate_workers" ADD CONSTRAINT "operate_workers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operate_workers" ADD CONSTRAINT "operate_workers_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operate_assignments" ADD CONSTRAINT "operate_assignments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "operate_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operate_assignments" ADD CONSTRAINT "operate_assignments_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

