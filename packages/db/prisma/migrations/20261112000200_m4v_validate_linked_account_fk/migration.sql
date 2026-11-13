-- m4v (Phase 4): validate the game_players → linked_accounts FK that M4 created NOT VALID (phase-04 plan 6.2, 6.5).
-- Its own migration, applied after M4: VALIDATE CONSTRAINT takes only a SHARE UPDATE EXCLUSIVE lock and scans
-- game_players without blocking reads or writes, whereas a validating ADD CONSTRAINT would hold an ACCESS EXCLUSIVE
-- lock for the whole scan. Every existing row has "linkedAccountId" NULL (the column is new), so the scan finds no
-- violation. Re-running it on a validated constraint is a no-op. Apply with `prisma migrate deploy` only.
SET lock_timeout = '5s';

ALTER TABLE "game_players" VALIDATE CONSTRAINT "game_players_linkedAccountId_fkey";
