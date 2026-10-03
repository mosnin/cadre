-- Sole statement, own transaction, after the NOT VALID constraint has committed.
ALTER TABLE "runs" VALIDATE CONSTRAINT "runs_parentRunId_fkey";
