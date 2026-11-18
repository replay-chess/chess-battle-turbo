-- M6 (Phase 6): the Weakness Profile (phase-06 plan 6.1-6.5): weekly snapshots, the per-side weakness inputs on
-- game_players and the weakness scope / version counters on training_profiles.
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- --shadow-database-url <local Docker Postgres 17> --script`, then hand-edited:
--   * a precondition guard first: every M2-M5 object P6 reads, joins or indexes (plan 2.3) must exist, and the JobKind
--     value RECOMPUTE_WEAKNESS must already be in M3's enum (plan 6.2.1: that is why there is no m6a), else the
--     migration fails loudly instead of patching another phase's schema;
--   * lock_timeout bounds the brief ACCESS EXCLUSIVE locks of the two ALTER TABLEs of existing tables (game_players,
--     training_profiles: constant defaults, metadata-only on PostgreSQL >= 11, no table rewrite), the FK to users and
--     the SHARE lock of the jobs index build (jobs is small: one row per pending or recent job);
--   * the script is re-runnable: CREATE TYPE and ADD CONSTRAINT sit in duplicate_object guards, the table and the index
--     use IF NOT EXISTS, every ADD COLUMN is IF NOT EXISTS (plan 6.2.2 asks it for stats / errorThemes in case a P3
--     build shipped them; here every column has it, so a half-applied script can be re-run);
--   * the array columns are NOT NULL DEFAULT ARRAY[] as plan 6.2.2 writes them (Prisma generates list columns
--     nullable, but its diff ignores a list column's nullability, so check-drift.ts stays clean); every new NOT NULL
--     column has a constant default, so inserts from the previous deployment keep working (data-model 11.5 rule 7);
--   * jobs."lastKickAt" is not added: M3 created it (the precondition checks it);
--   * the raw SQL block at the end is what Prisma does not model (lz4 on the metrics document, the partial index
--     jobs_user_active_idx). The index name is listed in prisma/protected-indexes.txt, so check-drift.ts ignores its
--     DROP INDEX line.
-- Expand-only: one enum, one table with an FK to users (created empty, so no NOT VALID step), eight defaulted columns,
-- one index. No drops, no type changes, no NOT NULL tightening of existing columns: the rollback is "stop writing"
-- (plan 14.4). Role grants are packages/db/scripts/roles/*.p6.sql, run per branch after this migration.
-- Apply with `prisma migrate deploy` only. Never `prisma db push` (it drops the partial index and the lz4 setting)
-- and never `prisma migrate dev` against Neon.

SET lock_timeout = '5s';

-- Preconditions (plan 2.3, 6.2.1): fail loudly when M2-M5 did not ship what P6 depends on.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('users', 'timeZone'), ('users', 'ratingBand'), ('games', 'startingFen'), ('games', 'startPly'),
      ('games', 'moves'), ('games', 'moveClocksMs'), ('games', 'initialTimeSeconds'), ('games', 'incrementSeconds'),
      ('games', 'completedAt'), ('games', 'whiteTitle'), ('games', 'blackTitle'), ('game_players', 'endedAt'),
      ('game_players', 'timeClass'), ('game_players', 'mode'), ('game_players', 'result'),
      ('game_players', 'ratingBefore'), ('game_players', 'source'), ('game_players', 'accuracy'),
      ('game_players', 'phaseAccuracy'), ('game_players', 'ecoCode'), ('game_players', 'bankVersion'),
      ('game_analyses', 'evals'), ('game_analyses', 'best'), ('game_analyses', 'judgements'),
      ('game_analyses', 'lines'), ('game_analyses', 'middlegamePly'), ('game_analyses', 'endgamePly'),
      ('jobs', 'dedupeKey'), ('jobs', 'lastKickAt'), ('jobs', 'userId'), ('linked_accounts', 'importState'),
      ('mistakes', 'themes'), ('mistakes', 'hiddenAt'), ('mistake_occurrences', 'ply'), ('training_cards', 'deck'),
      ('training_attempts', 'reviewedAt'), ('training_profiles', 'lastWeaknessSeenVersion'),
      ('training_profiles', 'updatedAt')
    ) AS t(tbl, name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = col.tbl AND column_name = col.name) THEN
      missing := missing || format('%s.%s', col.tbl, col.name);
    END IF;
  END LOOP;
  FOR col IN
    SELECT * FROM (VALUES ('JobKind', 'RECOMPUTE_WEAKNESS'), ('JobKind', 'ANALYZE_GAME'), ('JobStatus', 'QUEUED'),
                          ('JobStatus', 'RUNNING'), ('TimeClass', 'BLITZ'), ('TimeClass', 'RAPID'),
                          ('SessionKind', 'WEAKNESS'), ('Judgement', 'MISS')) AS t(typ, val)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                    WHERE t.typname = col.typ AND e.enumlabel = col.val) THEN
      missing := missing || format('enum %s.%s', col.typ, col.val);
    END IF;
  END LOOP;
  IF to_regclass('"game_players_userId_endedAt_gameId_idx"') IS NULL THEN
    missing := missing || 'index game_players_userId_endedAt_gameId_idx'::text;
  END IF;
  IF to_regclass('"training_cards_userId_deck_due_idx"') IS NULL THEN
    missing := missing || 'index training_cards_userId_deck_due_idx'::text;
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M6 preconditions missing (phase-06 plan 2.3; apply M2-M5 first; a missing JobKind RECOMPUTE_WEAKNESS needs m6a, plan 6.2.1): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WeaknessStatus" AS ENUM ('INSUFFICIENT', 'COMPUTING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable (metadata-only: constant defaults)
ALTER TABLE "game_players"
  ADD COLUMN IF NOT EXISTS "stats" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS "errorThemes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "errorLog" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS "errorThemeN" SMALLINT[] NOT NULL DEFAULT ARRAY[]::SMALLINT[],
  ADD COLUMN IF NOT EXISTS "weaknessInputsV" SMALLINT NOT NULL DEFAULT 0;

-- AlterTable (metadata-only: constant defaults)
ALTER TABLE "training_profiles"
  ADD COLUMN IF NOT EXISTS "weaknessVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "weaknessTimeClasses" "TimeClass"[] NOT NULL DEFAULT ARRAY[]::"TimeClass"[],
  ADD COLUMN IF NOT EXISTS "weaknessMonths" SMALLINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "weakness_snapshots" (
    "userId" BIGINT NOT NULL,
    "weekStart" DATE NOT NULL,
    "algoVersion" SMALLINT NOT NULL,
    "status" "WeaknessStatus" NOT NULL,
    "timeClasses" "TimeClass"[] NOT NULL DEFAULT ARRAY[]::"TimeClass"[],
    "since" TIMESTAMP(3),
    "gamesInScope" SMALLINT NOT NULL,
    "gamesAnalysed" SMALLINT NOT NULL,
    "ratingBandMin" SMALLINT,
    "ratingBandMax" SMALLINT,
    "metrics" JSONB NOT NULL,
    "headline" VARCHAR(200),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weakness_snapshots_pkey" PRIMARY KEY ("userId","weekStart")
);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "weakness_snapshots" ADD CONSTRAINT "weakness_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Raw SQL Prisma does not model (prisma/protected-indexes.txt; plan 6.2.2, 6.5) ────────────────────────────────────
-- The metrics document is read whole (4-6 KB): compress it with lz4 like P5's JSON documents.
ALTER TABLE "weakness_snapshots" ALTER COLUMN "metrics" SET COMPRESSION lz4;
-- The member's active jobs (TR-5 progress probe Q-W3: kinds ANALYZE_GAME / RECOMPUTE_WEAKNESS / IMPORT_SYNC,
-- status QUEUED or RUNNING; architecture 1.10.1, optimization 3.5.3). Partial, so finished jobs never enter it.
CREATE INDEX IF NOT EXISTS "jobs_user_active_idx" ON "jobs" ("userId", "kind") WHERE "status" IN ('QUEUED', 'RUNNING');
-- The role grants live in packages/db/scripts/roles/replay_worker.p6.sql and replay_app.p6.sql (run per branch after
-- this migration), not here.
