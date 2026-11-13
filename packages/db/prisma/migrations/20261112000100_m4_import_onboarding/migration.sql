-- M4 (Phase 4): game import, connected accounts, onboarding v3, the trial ledger and the audit log
-- (phase-04 plan 6.1-6.5; D4-03, D4-10, D4-11, D4-12, D4-21, D4-22).
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- --shadow-database-url <local Docker Postgres 17> --script`, then hand-edited:
--   * a precondition guard first: every M2/M3 object P4 reads or writes (plan 2.3) must exist, else the migration
--     fails loudly instead of patching another phase's schema (interface check 2026-11-12: all present, so P4 writes
--     no R-01 safety columns; scripts/check-p4-preconditions.ts runs the same checks against any database, read-only);
--   * lock_timeout guards the ALTER TABLEs on users and game_players;
--   * the script is re-runnable: every CREATE TYPE and ADD CONSTRAINT is wrapped in a duplicate_object guard, tables
--     and indexes use IF NOT EXISTS, columns ADD COLUMN IF NOT EXISTS (the billing columns P4 writes are declared
--     IF NOT EXISTS anyway, plan 6.2: P10 no longer re-declares them);
--   * the generated game_players → linked_accounts FK is replaced by the NOT VALID form (validated in m4v, so no
--     ACCESS EXCLUSIVE scan of game_players here);
--   * the raw SQL block at the end (partial indexes, lz4, fillfactor) is what Prisma does not model. Its index names
--     are listed in prisma/protected-indexes.txt, so scripts/db/check-drift.ts ignores their DROP INDEX lines;
--   * import_purge_batch() (plan 8.12 as one SECURITY DEFINER function: the worker purges imported rows without
--     DELETE on games / game_players).
-- Expand-only: 10 enums, 5 tables, 17 nullable or defaulted columns on users and one on game_players
-- (metadata-only on PostgreSQL >= 11, no rewrite), FKs from the new tables and one NOT VALID FK. No drops, no type
-- changes, no NOT NULL tightening: the rollback is "stop writing" (plan 14.4). No token columns (D4-21).
-- NOT here: users."gamesVersion" (M1), games.source / externalId / names / ratings / titles and GameSource (M2),
-- ecoCode / openingName / analysisStatus and jobs."fairSeq" / "lastKickAt" (M3), JobKind IMPORT_* (M3), and every
-- role grant (packages/db/scripts/roles/*.p4.sql, run per branch after this migration).
-- Apply with `prisma migrate deploy` only. Never `prisma db push` (it drops the partial indexes and the storage
-- settings) and never `prisma migrate dev` against Neon.

SET lock_timeout = '5s';

-- Preconditions (plan 2.3): fail loudly when M2/M3 did not ship what P4 depends on.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('games', 'source'), ('game_players', 'source'), ('games', 'externalId'), ('games', 'externalUrl'),
      ('games', 'whiteName'), ('games', 'blackName'), ('games', 'whiteRating'), ('games', 'blackRating'),
      ('games', 'whiteTitle'), ('games', 'blackTitle'), ('games', 'ecoCode'), ('games', 'openingName'),
      ('games', 'analysisStatus'), ('game_players', 'ecoCode'), ('jobs', 'fairSeq'), ('jobs', 'lastKickAt'),
      ('users', 'gamesVersion')
    ) AS t(tbl, name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = col.tbl AND column_name = col.name) THEN
      missing := missing || format('%s.%s', col.tbl, col.name);
    END IF;
  END LOOP;
  FOR col IN
    SELECT * FROM (VALUES ('GameSource', 'CHESSCOM'), ('GameSource', 'LICHESS'), ('GameMode', 'IMPORTED'),
                          ('GameEndMethod', 'OTHER'), ('JobKind', 'IMPORT_SYNC'), ('JobKind', 'IMPORT_PURGE')) AS t(typ, val)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                    WHERE t.typname = col.typ AND e.enumlabel = col.val) THEN
      missing := missing || format('enum %s.%s', col.typ, col.val);
    END IF;
  END LOOP;
  IF to_regclass('"games_source_externalId_key"') IS NULL THEN missing := missing || 'index games_source_externalId_key'::text; END IF;
  IF to_regclass('jobs_ready_idx') IS NULL THEN missing := missing || 'index jobs_ready_idx'::text; END IF;
  IF to_regclass('"jobs_dedupeKey_key"') IS NULL THEN missing := missing || 'index jobs_dedupeKey_key'::text; END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M4 preconditions missing (phase-04 plan 2.3; apply M2/M3 first): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ChessProvider" AS ENUM ('CHESSCOM', 'LICHESS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LinkStatus" AS ENUM ('ACTIVE', 'ERROR', 'RELINK_REQUIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportState" AS ENUM ('IDLE', 'WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING', 'RATE_LIMITED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportRunStatus" AS ENUM ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ImportTrigger" AS ENUM ('INITIAL', 'MANUAL', 'DAILY', 'RETRY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OnboardingStep" AS ENUM ('WELCOME', 'LINK', 'CONFIRM', 'LEVEL', 'GOALS', 'PLAN', 'ACTIVATING', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "RatingBand" AS ENUM ('NEW_TO_CHESS', 'UNDER_800', 'R800_1200', 'R1200_1600', 'R1600_2000', 'R2000_PLUS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "OnboardingGoal" AS ENUM ('STOP_BLUNDERING', 'LEARN_OPENINGS', 'IMPROVE_ENDGAMES', 'STUDY_LEGENDS', 'PLAY_FRIENDS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AuditCategory" AS ENUM ('ACCOUNT', 'BILLING', 'ADMIN', 'CONTENT', 'TOURNAMENT', 'MODERATION', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AuditActor" AS ENUM ('USER', 'ADMIN', 'SYSTEM', 'WORKER', 'WEBHOOK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable (R-01: created here; the FK is added NOT VALID below and validated in m4v)
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "linkedAccountId" BIGINT;

-- AlterTable: onboarding v3 (plan 6.1), the time zone (R-03) and the billing columns P4 writes (plan 6.2)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "dailyMinutes" SMALLINT,
ADD COLUMN IF NOT EXISTS "goals" "OnboardingGoal"[] DEFAULT ARRAY[]::"OnboardingGoal"[],
ADD COLUMN IF NOT EXISTS "initialRating" SMALLINT,
ADD COLUMN IF NOT EXISTS "lastCheckoutSource" VARCHAR(16),
ADD COLUMN IF NOT EXISTS "lastPaymentFailedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastPaymentFailureReason" VARCHAR(120),
ADD COLUMN IF NOT EXISTS "membershipEndedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "onboardedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'WELCOME',
ADD COLUMN IF NOT EXISTS "pendingCheckoutAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pendingCheckoutPlan" VARCHAR(16),
ADD COLUMN IF NOT EXISTS "pendingCheckoutSessionId" VARCHAR(80),
ADD COLUMN IF NOT EXISTS "ratingBand" "RatingBand",
ADD COLUMN IF NOT EXISTS "ratingBandSource" VARCHAR(24),
ADD COLUMN IF NOT EXISTS "signupSource" VARCHAR(200),
ADD COLUMN IF NOT EXISTS "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS "trialOfferedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "AuditCategory" NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "actorKind" "AuditActor" NOT NULL,
    "actorUserId" BIGINT,
    "targetType" VARCHAR(32),
    "targetId" VARCHAR(64),
    "requestId" VARCHAR(40),
    "meta" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "linked_accounts" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "provider" "ChessProvider" NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "username" VARCHAR(40) NOT NULL,
    "usernameLower" VARCHAR(40) NOT NULL,
    "displayName" VARCHAR(80),
    "avatarUrl" VARCHAR(300),
    "countryCode" CHAR(2),
    "title" VARCHAR(4),
    "joinedAt" TIMESTAMP(3),
    "ratings" JSONB,
    "totalRatedGames" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "verifyCode" VARCHAR(16),
    "status" "LinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "importState" "ImportState" NOT NULL DEFAULT 'IDLE',
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "autoImport" BOOLEAN NOT NULL DEFAULT true,
    "nextAutoSyncAt" TIMESTAMP(3),
    "nextAllowedSyncAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOkAt" TIMESTAMP(3),
    "lastError" JSONB,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linked_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "import_cursors" (
    "linkedAccountId" BIGINT NOT NULL,
    "provider" "ChessProvider" NOT NULL,
    "archivesEtag" VARCHAR(120),
    "archivesLastModified" VARCHAR(40),
    "archives" JSONB,
    "lichessSinceMs" BIGINT,
    "lichessResumeUntilMs" BIGINT,
    "oldestImportedAt" TIMESTAMP(3),
    "seen" INTEGER NOT NULL DEFAULT 0,
    "skippedVariants" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_cursors_pkey" PRIMARY KEY ("linkedAccountId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "import_runs" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "linkedAccountId" BIGINT NOT NULL,
    "provider" "ChessProvider" NOT NULL,
    "trigger" "ImportTrigger" NOT NULL,
    "status" "ImportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" VARCHAR(8),
    "seen" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "analysisQueued" SMALLINT NOT NULL DEFAULT 0,
    "analysed" SMALLINT NOT NULL DEFAULT 0,
    "firstGameId" BIGINT,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "trial_ledger" (
    "emailHash" CHAR(64) NOT NULL,
    "handleHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstTrialAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_ledger_pkey" PRIMARY KEY ("emailHash")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_category_at_idx" ON "audit_logs"("category", "at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "linked_accounts_provider_usernameLower_idx" ON "linked_accounts"("provider", "usernameLower");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "linked_accounts_userId_provider_key" ON "linked_accounts"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "import_runs_referenceId_key" ON "import_runs"("referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_runs_userId_createdAt_idx" ON "import_runs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_runs_linkedAccountId_createdAt_idx" ON "import_runs"("linkedAccountId", "createdAt" DESC);

-- AddForeignKey (NOT VALID: no ACCESS EXCLUSIVE scan of game_players now; m4v validates it)
DO $$ BEGIN
  ALTER TABLE "game_players" ADD CONSTRAINT "game_players_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId")
    REFERENCES "linked_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "import_cursors" ADD CONSTRAINT "import_cursors_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "linked_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "linked_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Raw SQL Prisma does not model (plan 6.2, 6.3). Index names: prisma/protected-indexes.txt ("# M4 (P4)"). ──────
-- The tables are new and tiny (dev: < 50 users), so plain CREATE INDEX inside the migration is fine (plan 6.5).

-- The FK's ON DELETE SET NULL when a link row is deleted (unlink) reads game_players by "linkedAccountId".
CREATE INDEX IF NOT EXISTS game_players_linked_account_idx
  ON game_players ("linkedAccountId") WHERE "linkedAccountId" IS NOT NULL;

-- One verified owner per external account (D4-10); unverified Chess.com links may coexist.
CREATE UNIQUE INDEX IF NOT EXISTS linked_accounts_verified_key
  ON linked_accounts (provider, "externalId") WHERE "verifiedAt" IS NOT NULL;

-- Backstop sweep for daily syncs whose job row was lost (D4-27): the worker's boot and its daily housekeeping run.
CREATE INDEX IF NOT EXISTS linked_accounts_autosync_idx
  ON linked_accounts ("nextAutoSyncAt") WHERE "autoImport" AND status = 'ACTIVE';

-- At most one active run per account: makes "sync already running" race-free (23505 → 409 sync_running).
CREATE UNIQUE INDEX IF NOT EXISTS import_runs_one_active
  ON import_runs ("linkedAccountId") WHERE status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING');

-- Entitlement fan-out: release one user's waiting runs (8.5.4).
CREATE INDEX IF NOT EXISTS import_runs_waiting_idx
  ON import_runs ("userId") WHERE status = 'WAITING_FOR_MEMBERSHIP';

-- 12 months of per-month validators in one JSON value: compress it (Neon builds have lz4, as M2's games.moves).
ALTER TABLE import_cursors ALTER COLUMN archives SET COMPRESSION lz4;
-- Counters and sync stamps are updated in place on every chunk: leave room for HOT updates.
ALTER TABLE linked_accounts SET (fillfactor = 85);

-- IMPORT_PURGE batch (plan 8.12) as one SECURITY DEFINER function, so the worker role never gets DELETE on games or
-- game_players (M3's least-privilege rule stays true: replay_worker can delete only IMPORTED rows, only through this
-- function). One call = one batch of at most p_limit of the member's rows of one non-REPLAY source: their game_players
-- rows, the QUEUED ANALYZE_GAME jobs of those games, one gamesVersion bump, then the games nobody else holds (cascading
-- game_analyses, player_reviews, shares), and for games another member also imported only this member's
-- whitePlayerId / blackPlayerId. Returns the counts and the game ids; loop until deleted_players = 0. Safe to re-send
-- after a lost response (it purges the next batch, or nothing). EXECUTE is revoked from PUBLIC here and granted to
-- replay_worker in scripts/roles/replay_worker.p4.sql.
CREATE OR REPLACE FUNCTION import_purge_batch(p_user bigint, p_source "GameSource", p_limit int DEFAULT 500)
RETURNS TABLE (deleted_players int, deleted_games int, cleared_games int, game_ids bigint[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  ids bigint[];
BEGIN
  IF p_source = 'REPLAY' THEN
    RAISE EXCEPTION 'import_purge_batch: REPLAY games are never purged';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'import_purge_batch: p_limit must be 1..1000';
  END IF;
  WITH victims AS (
    SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = p_user AND gp.source = p_source LIMIT p_limit
  ), del_gp AS (
    DELETE FROM game_players gp USING victims v
     WHERE gp."gameId" = v."gameId" AND gp."userId" = p_user AND gp.source = p_source
    RETURNING gp."gameId"
  ), del_jobs AS (
    DELETE FROM jobs j
     WHERE j.kind = 'ANALYZE_GAME' AND j.status = 'QUEUED' AND j."gameId" IN (SELECT "gameId" FROM del_gp)
    RETURNING 1
  ), ver AS (
    UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
     WHERE u.id = p_user AND EXISTS (SELECT 1 FROM del_gp)
    RETURNING 1
  )
  SELECT COALESCE(array_agg(DISTINCT d."gameId"), ARRAY[]::bigint[]) INTO ids FROM del_gp d;
  deleted_players := cardinality(ids);
  game_ids := ids;
  DELETE FROM games g
   WHERE g.id = ANY (ids) AND g.source <> 'REPLAY'
     AND NOT EXISTS (SELECT 1 FROM game_players p WHERE p."gameId" = g.id);
  GET DIAGNOSTICS deleted_games = ROW_COUNT;
  UPDATE games g
     SET "whitePlayerId" = CASE WHEN g."whitePlayerId" = p_user THEN NULL ELSE g."whitePlayerId" END,
         "blackPlayerId" = CASE WHEN g."blackPlayerId" = p_user THEN NULL ELSE g."blackPlayerId" END,
         "updatedAt" = now()
   WHERE g.id = ANY (ids) AND (g."whitePlayerId" = p_user OR g."blackPlayerId" = p_user);
  GET DIAGNOSTICS cleared_games = ROW_COUNT;
  RETURN NEXT;
END
$fn$;
REVOKE ALL ON FUNCTION import_purge_batch(bigint, "GameSource", int) FROM PUBLIC;
