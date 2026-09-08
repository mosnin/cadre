ALTER TABLE "computers" ADD COLUMN "startupDrainUntil" TIMESTAMP(3);
-- The prior runtime has no ownership fences. Allow it to drain before new
-- workers reclaim legacy boot intents during the rolling deployment.
UPDATE "computers" SET "startupExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '6 minutes'
WHERE "state" = 'booting' AND "startupOperationId" IS NULL AND "startupRequestedAt" IS NULL;
