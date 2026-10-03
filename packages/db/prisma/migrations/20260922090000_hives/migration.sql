-- AlterTable
ALTER TABLE "chat_group_members" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'worker';

-- CreateTable
CREATE TABLE "hives" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "realityLevel" INTEGER NOT NULL DEFAULT 0,
    "budgetTokens" INTEGER NOT NULL,
    "external" JSONB,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_tasks" (
    "id" TEXT NOT NULL,
    "hiveId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "acceptance" JSONB NOT NULL DEFAULT '[]',
    "ownership" TEXT[],
    "assigneeBotId" TEXT,
    "creatorBotId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runId" TEXT,
    "claimLeaseUntil" TIMESTAMP(3),
    "claimFence" INTEGER NOT NULL DEFAULT 0,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hive_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_task_dependencies" (
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "hive_task_dependencies_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "hive_evidence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sha256" TEXT,
    "authorBotId" TEXT NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_receipts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "auditorBotId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "scores" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hive_wakes" (
    "id" TEXT NOT NULL,
    "hiveId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "runId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hive_wakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hives_groupId_key" ON "hives"("groupId");

-- CreateIndex
CREATE INDEX "hives_spaceId_userId_status_idx" ON "hives"("spaceId", "userId", "status");

-- CreateIndex
CREATE INDEX "hive_tasks_hiveId_status_idx" ON "hive_tasks"("hiveId", "status");

-- CreateIndex
CREATE INDEX "hive_tasks_runId_idx" ON "hive_tasks"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "hive_tasks_hiveId_key_key" ON "hive_tasks"("hiveId", "key");

-- CreateIndex
CREATE INDEX "hive_task_dependencies_dependsOnId_idx" ON "hive_task_dependencies"("dependsOnId");

-- CreateIndex
CREATE INDEX "hive_evidence_taskId_createdAt_idx" ON "hive_evidence"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "hive_receipts_taskId_createdAt_idx" ON "hive_receipts"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hive_wakes_key_key" ON "hive_wakes"("key");

-- CreateIndex
CREATE INDEX "hive_wakes_hiveId_consumedAt_idx" ON "hive_wakes"("hiveId", "consumedAt");

-- AddForeignKey
ALTER TABLE "hives" ADD CONSTRAINT "hives_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hives" ADD CONSTRAINT "hives_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_tasks" ADD CONSTRAINT "hive_tasks_hiveId_fkey" FOREIGN KEY ("hiveId") REFERENCES "hives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_task_dependencies" ADD CONSTRAINT "hive_task_dependencies_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "hive_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_task_dependencies" ADD CONSTRAINT "hive_task_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "hive_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_evidence" ADD CONSTRAINT "hive_evidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "hive_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_receipts" ADD CONSTRAINT "hive_receipts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "hive_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hive_wakes" ADD CONSTRAINT "hive_wakes_hiveId_fkey" FOREIGN KEY ("hiveId") REFERENCES "hives"("id") ON DELETE CASCADE ON UPDATE CASCADE;
