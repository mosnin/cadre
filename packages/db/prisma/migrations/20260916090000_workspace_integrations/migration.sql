CREATE TABLE workspace_integrations (
  id TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('operate', 'stored')),
  "externalId" TEXT NOT NULL,
  "externalName" TEXT NOT NULL,
  UNIQUE ("spaceId", provider)
);
CREATE TABLE workspace_integration_grants (
  id TEXT PRIMARY KEY,
  "bindingId" TEXT NOT NULL REFERENCES workspace_integrations(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  UNIQUE ("bindingId", "userId")
);
CREATE TABLE workspace_integration_states (
  state TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL
);
CREATE TABLE stored_memory_outbox (
  id TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "botId" TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER,
  ciphertext TEXT NOT NULL,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX stored_memory_outbox_due ON stored_memory_outbox("nextAttemptAt");
