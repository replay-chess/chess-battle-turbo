-- m4a (Phase 4): the enum values P4 is the first writer of (phase-04 plan 2.3, 6.5).
-- Both values were created by M2 (20261106000100_m2_play_model, checked on a fresh `migrate deploy` 2026-11-12), so
-- both lines are true no-ops there. They stay as the belt-and-braces net the plan asks for: a database whose M2 lacked
-- them gets them here, in a file of their own, because a new enum value cannot be used in the transaction that adds
-- it and must ship one release before its first writer (the import batch writer; feasibility §9 two-release rule).
-- The `JobKind` lines of the first draft are gone: M3 created IMPORT_SYNC and IMPORT_PURGE (R-05).
-- Metadata-only. Apply with `prisma migrate deploy` only (never `prisma db push`, never `migrate dev` on Neon).
SET lock_timeout = '5s';

ALTER TYPE "GameMode" ADD VALUE IF NOT EXISTS 'IMPORTED';
ALTER TYPE "GameEndMethod" ADD VALUE IF NOT EXISTS 'OTHER';
