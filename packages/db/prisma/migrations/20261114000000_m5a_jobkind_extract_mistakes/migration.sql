-- m5a (Phase 5): the JobKind value the Mistake Bank backfill writes (phase-05 plan 6.6; feasibility 9 rule 1).
-- A file of its own: a new enum value cannot be used in the transaction that adds it, and it ships one release
-- before its first writer (release N: this file plus Prisma clients in the web and the worker that know the value;
-- release N+1, at least a day later: the EXTRACT_MISTAKES backfill script and the EXTRACT_VERSION bump path). Rolling
-- back from N+1 to N is then safe. IF NOT EXISTS makes it a no-op on a database that already has the value.
-- Metadata-only. Apply with `prisma migrate deploy` only (never `prisma db push`, never `migrate dev` on Neon).
SET lock_timeout = '5s';

ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'EXTRACT_MISTAKES';
