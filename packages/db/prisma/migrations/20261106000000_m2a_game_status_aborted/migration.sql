-- M2a (Phase 2): GameStatus += ABORTED (phase-02 plan 6.1).
-- Its own migration: a new enum value cannot be used in the transaction that adds it, and it must deploy one
-- release before any writer of ABORTED (the socket abort path, the stale sweeps; data-model §11.1.6,
-- feasibility §9 two-release rule). Metadata-only. Apply with `prisma migrate deploy` only.
SET lock_timeout = '5s';

ALTER TYPE "GameStatus" ADD VALUE IF NOT EXISTS 'ABORTED';
