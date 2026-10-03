-- Sole statement in this migration so it runs outside an implicit transaction:
-- CREATE INDEX CONCURRENTLY errors inside one. Makes a replayed spawn_agent call
-- unable to create a second child for the same parent tool call.
CREATE UNIQUE INDEX CONCURRENTLY "runs_parentRunId_parentToolCallId_key" ON "runs"("parentRunId", "parentToolCallId");
