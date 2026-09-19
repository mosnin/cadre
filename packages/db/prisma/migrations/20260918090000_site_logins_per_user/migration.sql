-- A saved login belongs to the person who saved it, not to everyone in the space. Scoping the
-- unique key by user lets two members keep their own credentials for the same site.
DROP INDEX "site_logins_spaceId_host_username_key";
DROP INDEX "site_logins_spaceId_idx";
CREATE UNIQUE INDEX "site_logins_spaceId_userId_host_username_key" ON "site_logins"("spaceId", "userId", "host", "username");
CREATE INDEX "site_logins_spaceId_userId_idx" ON "site_logins"("spaceId", "userId");
