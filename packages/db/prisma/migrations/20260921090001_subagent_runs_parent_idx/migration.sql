-- Sole statement in this migration so it runs outside an implicit
-- transaction: CREATE INDEX CONCURRENTLY errors inside one.
CREATE INDEX CONCURRENTLY "runs_parentRunId_idx" ON "runs"("parentRunId");
