-- NOT VALID lets this commit without scanning the table; VALIDATE CONSTRAINT runs in the
-- next migration, in its own transaction.
ALTER TABLE "runs" ADD CONSTRAINT "runs_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
