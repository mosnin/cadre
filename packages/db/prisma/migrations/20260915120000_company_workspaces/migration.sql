ALTER TABLE spaces ADD COLUMN "companyOsCompanyId" TEXT, ADD COLUMN "companyOsCompanyName" TEXT, ADD COLUMN "companyOsCompanySlug" TEXT;
CREATE TABLE company_workspace_grants (
  id TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "companyId" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "companySlug" TEXT NOT NULL,
  subject TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  UNIQUE ("spaceId", "userId")
);
CREATE TABLE company_workspace_oauth_states (
  state TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX company_workspace_grants_user ON company_workspace_grants("userId");
