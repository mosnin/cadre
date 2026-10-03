-- Sole statement in this migration so it runs outside an implicit
-- transaction: CREATE INDEX CONCURRENTLY errors inside one. Hive and sub-agent token budgets
-- sum usage by run.
CREATE INDEX CONCURRENTLY "usage_records_runId_idx" ON "usage_records"("runId");
