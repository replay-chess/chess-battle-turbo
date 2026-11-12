-- M3 (Phase 3): server analysis and Game Review (phase-03 plan 6.1-6.3, 6.7).
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- --shadow-database-url <local Docker Postgres 17> --script`, then hand-edited:
--   * lock_timeout guards the ALTER TABLEs on games, game_players and openings;
--   * every CREATE TYPE is wrapped in a duplicate_object guard and every added column uses ADD COLUMN IF NOT EXISTS
--     (plan 6.7 step 3: M3 stays correct whatever P2 shipped; P2 shipped none of them, checked 2026-11-11);
--   * the raw SQL block at the end (partial indexes, lz4, review_progress_merge) is what Prisma does not model. Its
--     index names are listed in prisma/protected-indexes.txt, so scripts/db/check-drift.ts ignores their DROP INDEX
--     lines.
-- Expand-only: 7 enums, 3 + 6 + 1 nullable or defaulted columns on games, game_players and openings (metadata-only
-- on PostgreSQL >= 11, no rewrite), 5 new tables, FKs from the new tables only. No drops, no type changes, no NOT
-- NULL tightening: the only rollback is "stop writing".
-- NOT here: users."gamesVersion" (M1 shipped it), games.source / game_players.source / GameSource (M2 shipped them),
-- and every role grant (packages/db/scripts/roles/*.sql, run per branch after the role exists; plan 6.3).
-- Apply with `prisma migrate deploy` only. Never `prisma db push` (it drops the partial indexes and the lz4
-- settings) and never `prisma migrate dev` against Neon.

SET lock_timeout = '5s';

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobKind" AS ENUM ('ANALYZE_GAME', 'REVIEW_TEXT', 'LEGEND_COMPARE', 'IMPORT_SYNC', 'IMPORT_PURGE', 'RECOMPUTE_WEAKNESS', 'EXPORT_BUILD', 'ACCOUNT_PURGE', 'DODO_CUSTOMER_SYNC', 'HOUSEKEEPING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AnalysisStatus" AS ENUM ('NONE', 'QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EvalSource" AS ENUM ('ENGINE', 'LICHESS', 'MIXED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Judgement" AS ENUM ('BRILLIANT', 'GREAT', 'BEST', 'EXCELLENT', 'GOOD', 'BOOK', 'FORCED', 'INTERESTING', 'INACCURACY', 'MISTAKE', 'MISS', 'BLUNDER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ComparisonStatus" AS ENUM ('FACTS_READY', 'NARRATING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ShareKind" AS ENUM ('POSITION', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "accuracy" REAL,
ADD COLUMN IF NOT EXISTS "counts" SMALLINT[] DEFAULT ARRAY[]::SMALLINT[],
ADD COLUMN IF NOT EXISTS "ecoCode" VARCHAR(3),
ADD COLUMN IF NOT EXISTS "headline" VARCHAR(80),
ADD COLUMN IF NOT EXISTS "momentsCount" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "phaseAccuracy" REAL[] DEFAULT ARRAY[]::REAL[];

-- AlterTable
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "ecoCode" VARCHAR(3),
ADD COLUMN IF NOT EXISTS "openingName" VARCHAR(80);

-- AlterTable
ALTER TABLE "openings" ADD COLUMN IF NOT EXISTS "epd" VARCHAR(90);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" SMALLINT NOT NULL DEFAULT 10,
    "fairSeq" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" VARCHAR(120),
    "userId" BIGINT,
    "gameId" BIGINT,
    "payload" JSONB NOT NULL DEFAULT '{"v":1}',
    "result" JSONB,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "maxAttempts" SMALLINT NOT NULL DEFAULT 4,
    "lockedBy" VARCHAR(40),
    "lockedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastKickAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_analyses" (
    "gameId" BIGINT NOT NULL,
    "version" SMALLINT NOT NULL,
    "engine" VARCHAR(48) NOT NULL,
    "nodesPass1" INTEGER NOT NULL,
    "nodesPass2" INTEGER NOT NULL,
    "evalSource" "EvalSource" NOT NULL DEFAULT 'ENGINE',
    "totalPlies" SMALLINT NOT NULL,
    "gradedPlies" SMALLINT NOT NULL,
    "failedAtPly" SMALLINT,
    "evals" SMALLINT[],
    "second" SMALLINT[],
    "best" SMALLINT[],
    "judgements" SMALLINT[],
    "lines" JSONB,
    "middlegamePly" SMALLINT,
    "endgamePly" SMALLINT,
    "accuracyWhite" REAL,
    "accuracyBlack" REAL,
    "countsWhite" SMALLINT[],
    "countsBlack" SMALLINT[],
    "depthP50" SMALLINT,
    "readyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "game_analyses_pkey" PRIMARY KEY ("gameId")
);

-- CreateTable
CREATE TABLE "player_reviews" (
    "gameId" BIGINT NOT NULL,
    "color" CHAR(1) NOT NULL,
    "content" JSONB,
    "textStatus" VARCHAR(10) NOT NULL DEFAULT 'PENDING',
    "model" VARCHAR(40),
    "promptVersion" SMALLINT,
    "progress" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_reviews_pkey" PRIMARY KEY ("gameId","color")
);

-- CreateTable
CREATE TABLE "legend_comparisons" (
    "gameId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "chessPositionId" BIGINT,
    "status" "ComparisonStatus" NOT NULL DEFAULT 'FACTS_READY',
    "facts" JSONB NOT NULL,
    "narration" JSONB,
    "model" VARCHAR(40),
    "costMicroUsd" INTEGER,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legend_comparisons_pkey" PRIMARY KEY ("gameId","userId")
);

-- CreateTable
CREATE TABLE "shares" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "kind" "ShareKind" NOT NULL,
    "ownerId" BIGINT,
    "fen" TEXT,
    "chessPositionId" BIGINT,
    "gameId" BIGINT,
    "ply" SMALLINT,
    "color" CHAR(1),
    "title" VARCHAR(80),
    "subtitle" VARCHAR(40),
    "note" VARCHAR(140),
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "showUsername" BOOLEAN NOT NULL DEFAULT true,
    "snapshot" JSONB,
    "imageVersion" SMALLINT NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "legend_comparisons_userId_idx" ON "legend_comparisons"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "shares_code_key" ON "shares"("code");

-- AddForeignKey
ALTER TABLE "game_analyses" ADD CONSTRAINT "game_analyses_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_reviews" ADD CONSTRAINT "player_reviews_gameId_color_fkey" FOREIGN KEY ("gameId", "color") REFERENCES "game_players"("gameId", "color") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legend_comparisons" ADD CONSTRAINT "legend_comparisons_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legend_comparisons" ADD CONSTRAINT "legend_comparisons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_chessPositionId_fkey" FOREIGN KEY ("chessPositionId") REFERENCES "chess_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Raw SQL (phase-03 plan 6.3) ──────────────────────────────────────────────────────────────────────────────
-- Job claim: ORDER BY priority DESC, "fairSeq", "runAt" over queued rows only (R-05.1, plan 8.12).
CREATE INDEX IF NOT EXISTS jobs_ready_idx     ON jobs (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED';
-- Stale-lock recovery (the reaper at worker boot and at the end of each drain).
CREATE INDEX IF NOT EXISTS jobs_running_idx   ON jobs ("heartbeatAt") WHERE status = 'RUNNING';
-- Pruning (HOUSEKEEPING prune-jobs: DONE > 14 d, FAILED/CANCELLED > 30 d).
CREATE INDEX IF NOT EXISTS jobs_finished_idx  ON jobs ("finishedAt") WHERE status IN ('DONE', 'FAILED', 'CANCELLED');
-- The archive filter "only games with moments" stays inside the user's rows: no index (<= 2,000 rows per user).
-- Book / opening lookup (the worker's deepest EPD match, one statement per game).
CREATE INDEX IF NOT EXISTS openings_epd_idx   ON openings (epd) WHERE epd IS NOT NULL;
-- Share reuse lookup (A10), the durable daily create cap (AP-11) and the owner listing (P10 "manage links").
CREATE INDEX IF NOT EXISTS shares_owner_idx   ON shares ("ownerId", "createdAt" DESC) WHERE kind = 'REVIEW';
-- Share pruning (HOUSEKEEPING prune-shares).
CREATE INDEX IF NOT EXISTS shares_expires_idx ON shares ("expiresAt") WHERE "expiresAt" IS NOT NULL;
-- FK index followed by the cascade from games (data-model §2 rule 9).
CREATE INDEX IF NOT EXISTS shares_game_idx    ON shares ("gameId") WHERE "gameId" IS NOT NULL;
-- Compression for the read-whole JSON documents. Applies to newly written values only; no rewrite.
ALTER TABLE game_analyses  ALTER COLUMN lines    SET COMPRESSION lz4;
ALTER TABLE player_reviews ALTER COLUMN content  SET COMPRESSION lz4;
ALTER TABLE shares         ALTER COLUMN snapshot SET COMPRESSION lz4;

-- A5 progress merge in one statement (plan 7.3 recordProgress). The route reduces the event batch into a patch in
-- TS ({results, attempts, planChips}) and passes the client's momentIndex. Monotonic by construction, so a
-- reordered or replayed beacon can never move progress backwards:
--   * momentIndex = max(stored, idx), clamped to 0..3 (3 = the walkthrough is complete);
--   * results: an existing ply key is never overwritten (first outcome wins); new keys are added;
--   * attempts: per-ply max of stored and patch (the client sends cumulative counts), capped at 50
--     (ReviewProgressV1);
--   * planChips: the latest chip per ply wins (the member may change their answer);
--   * bankOptOut is A6's and is carried over untouched.
-- Plain jsonb operations, no plpgsql loop. A NULL p (first write) reads as empty progress.
CREATE OR REPLACE FUNCTION review_progress_merge(p jsonb, patch jsonb, idx int) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'momentIndex', LEAST(3, GREATEST(COALESCE((p->>'momentIndex')::int, 0), COALESCE(idx, 0), 0)),
    'results', COALESCE(p->'results', '{}'::jsonb)
               || (COALESCE(patch->'results', '{}'::jsonb)
                   - ARRAY(SELECT jsonb_object_keys(COALESCE(p->'results', '{}'::jsonb)))),
    'attempts', COALESCE((
        SELECT jsonb_object_agg(k, LEAST(50, GREATEST(COALESCE((p->'attempts'->>k)::int, 0),
                                                      COALESCE((patch->'attempts'->>k)::int, 0))))
          FROM (SELECT jsonb_object_keys(COALESCE(p->'attempts', '{}'::jsonb))
                UNION
                SELECT jsonb_object_keys(COALESCE(patch->'attempts', '{}'::jsonb))) AS keys(k)
      ), '{}'::jsonb),
    'planChips', COALESCE(p->'planChips', '{}'::jsonb) || COALESCE(patch->'planChips', '{}'::jsonb),
    'bankOptOut', COALESCE(p->'bankOptOut', '[]'::jsonb))
$$;
