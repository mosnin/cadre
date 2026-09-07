ALTER TABLE "bots" ADD COLUMN "systemRole" TEXT;
CREATE UNIQUE INDEX "bots_spaceId_systemRole_key" ON "bots"("spaceId", "systemRole");
ALTER TABLE "bots" ADD CONSTRAINT "chippi_system_identity" CHECK (
  ("systemRole" IS NULL AND id !~ '^chippi_') OR
  (COALESCE("systemRole" = 'chippi', false) AND id ~ '^chippi_[a-f0-9]{64}$' AND name = 'Chippi' AND pinned = true AND "archivedAt" IS NULL AND "sectionId" IS NULL AND "parentBotId" IS NULL)
);
CREATE FUNCTION protect_chippi_orchestrator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."systemRole" = 'chippi' THEN
    IF TG_OP = 'DELETE' THEN
      -- Deleting the parent workspace/account remains a supported lifecycle.
      IF EXISTS (SELECT 1 FROM spaces WHERE id = OLD."spaceId") THEN
        RAISE EXCEPTION 'Chippi cannot be deleted';
      END IF;
      RETURN OLD;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
       OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."systemRole" IS DISTINCT FROM OLD."systemRole" THEN
      RAISE EXCEPTION 'Chippi system identity is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_chippi_orchestrator BEFORE UPDATE OR DELETE ON bots
FOR EACH ROW EXECUTE FUNCTION protect_chippi_orchestrator();

CREATE TABLE workforce_request_nonces (id TEXT PRIMARY KEY, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX workforce_request_nonces_expiry ON workforce_request_nonces("expiresAt");

ALTER TABLE runs ADD COLUMN "workforceAuthority" JSONB;
ALTER TABLE routines ADD COLUMN "workforceAuthority" JSONB;
