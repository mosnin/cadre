-- Saved website logins that bots can type into password fields without seeing the value.
CREATE TABLE "site_logins" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_logins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_logins_secretId_key" ON "site_logins"("secretId");
CREATE UNIQUE INDEX "site_logins_spaceId_host_username_key" ON "site_logins"("spaceId", "host", "username");
CREATE INDEX "site_logins_spaceId_idx" ON "site_logins"("spaceId");

ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "site_logins" ADD CONSTRAINT "site_logins_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "secrets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
