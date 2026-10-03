-- Agent-spawned sub-agents: child runs (trigger "subagent") form a tree under their parent run.
ALTER TABLE "runs" ADD COLUMN "parentRunId" TEXT;
ALTER TABLE "runs" ADD COLUMN "rootRunId" TEXT;
ALTER TABLE "runs" ADD COLUMN "parentToolCallId" TEXT;
ALTER TABLE "runs" ADD COLUMN "subagentDepth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "runs" ADD COLUMN "agentType" TEXT;
ALTER TABLE "runs" ADD COLUMN "agentLabel" TEXT;
ALTER TABLE "runs" ADD COLUMN "agentResult" TEXT;
ALTER TABLE "runs" ADD COLUMN "agentResultDeliveredAt" TIMESTAMP(3);
ALTER TABLE "runs" ADD COLUMN "agentBackground" BOOLEAN;
ALTER TABLE "runs" ADD COLUMN "agentInbox" JSONB;
ALTER TABLE "runs" ADD COLUMN "agentWait" JSONB;
ALTER TABLE "runs" ADD COLUMN "agentWaitKey" TEXT;

-- Custom sub-agent types a bot may spawn.
ALTER TABLE "bots" ADD COLUMN "subagentTypes" JSONB;

-- Durable plan state for agents that spawn sub-agents.
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "rootRunId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedRunId" TEXT,
    "result" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_tasks_botId_threadId_status_idx" ON "agent_tasks"("botId", "threadId", "status");
CREATE INDEX "agent_tasks_rootRunId_idx" ON "agent_tasks"("rootRunId");
CREATE INDEX "agent_tasks_assignedRunId_idx" ON "agent_tasks"("assignedRunId");

ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
