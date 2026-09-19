-- New accounts get the orb. Everyone who already chose robot or organic keeps
-- it: only the column default moves, no existing row is rewritten.
ALTER TABLE "user" ALTER COLUMN "avatarStyle" SET DEFAULT 'orb';
