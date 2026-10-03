-- Burst devices act as bot computers. Requests relay through device_rpcs so any server
-- process can reach the process holding the device's stream.
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_rpcs" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_rpcs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "bots" ADD COLUMN "deviceId" TEXT;

CREATE INDEX "devices_userId_idx" ON "devices"("userId");
CREATE INDEX "device_rpcs_deviceId_status_idx" ON "device_rpcs"("deviceId", "status");
CREATE INDEX "device_rpcs_expiresAt_idx" ON "device_rpcs"("expiresAt");
CREATE INDEX "bots_deviceId_idx" ON "bots"("deviceId");

ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_rpcs" ADD CONSTRAINT "device_rpcs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bots" ADD CONSTRAINT "bots_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
