-- There is one way an agent is drawn — the orb, in the agent's own colour — so
-- there is no style to store. The column held a choice between renderers that
-- no longer exist.
ALTER TABLE "user" DROP COLUMN "avatarStyle";
