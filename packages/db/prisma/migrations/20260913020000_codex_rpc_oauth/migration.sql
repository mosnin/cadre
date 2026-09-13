CREATE TABLE "CodexOAuthGrant" (
 "id" text PRIMARY KEY,
 "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
 "scope" text NOT NULL CHECK ("scope" IN ('cadre:read', 'cadre:read cadre:execute')),
 "redirectUri" text NOT NULL,
 "challenge" text NOT NULL,
 "codeHash" text NOT NULL UNIQUE,
 "codeExpiresAt" timestamptz NOT NULL,
 "codeUsedAt" timestamptz,
 "accessHash" text UNIQUE,
 "accessExpiresAt" timestamptz,
 "refreshHash" text UNIQUE,
 "expiresAt" timestamptz NOT NULL,
 "revokedAt" timestamptz,
 "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "CodexOAuthGrant_userId_createdAt" ON "CodexOAuthGrant"("userId", "createdAt");
CREATE INDEX "CodexOAuthGrant_expiry" ON "CodexOAuthGrant"("expiresAt");
CREATE TABLE "CodexOAuthSpent" (
 "hash" text PRIMARY KEY,
 "createdAt" timestamptz NOT NULL DEFAULT now(),
 "grantId" text NOT NULL REFERENCES "CodexOAuthGrant"("id") ON DELETE CASCADE
);
CREATE INDEX "CodexOAuthSpent_grantId_createdAt" ON "CodexOAuthSpent"("grantId", "createdAt");
REVOKE ALL ON "CodexOAuthGrant", "CodexOAuthSpent" FROM PUBLIC;
