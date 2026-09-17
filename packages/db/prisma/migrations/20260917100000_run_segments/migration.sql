-- Long runs continue across budget segments with a progress note instead of failing.
ALTER TABLE "runs" ADD COLUMN "segment" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "runs" ADD COLUMN "progressNote" TEXT;
