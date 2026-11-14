-- M5 (Phase 5): the Mistake Bank, training cards and attempts, sessions, the training day and profile, theme mastery
-- and content reports (phase-05 plan 6.1-6.6).
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- --shadow-database-url <local Docker Postgres 17> --script`, then hand-edited:
--   * a precondition guard first: every M2/M3/M4 object P5 reads or joins (plan 2.3) and m5a's JobKind value must
--     exist, else the migration fails loudly instead of patching another phase's schema;
--   * lock_timeout guards the one ALTER of an existing table (game_players."bankVersion", metadata-only on
--     PostgreSQL >= 11: a constant default, no rewrite) and the FK additions that lock users / games briefly;
--   * the script is re-runnable: every CREATE TYPE and ADD CONSTRAINT sits in a duplicate_object guard, tables and
--     indexes use IF NOT EXISTS, the column ADD COLUMN IF NOT EXISTS;
--   * the raw SQL block at the end is what Prisma does not model (the partial index training_attempts_puzzle_idx,
--     fillfactor 80 on the three counter tables for HOT updates, lz4 on the two JSON columns). Its index name is listed
--     in prisma/protected-indexes.txt, so scripts/db/check-drift.ts ignores its DROP INDEX line.
-- Expand-only: 11 enums, 9 tables, one defaulted column on game_players, FKs from the new tables only. Nothing touches
-- users or player_reviews, and there is no key_moments table (a moment is PlayerReview.content.moments[i]; the link
-- to the bank is mistake_occurrences (gameId, ply)). No drops, no type changes, no NOT NULL tightening: the rollback is
-- "stop writing" (plan 13.4). JobKind EXTRACT_MISTAKES is m5a's (its own file); role grants are
-- packages/db/scripts/roles/*.p5.sql, run per branch after this migration.
-- Apply with `prisma migrate deploy` only. Never `prisma db push` (it drops the partial index and the storage
-- settings) and never `prisma migrate dev` against Neon.

SET lock_timeout = '5s';

-- Preconditions (plan 2.3): fail loudly when M2/M3/M4 or m5a did not ship what P5 depends on.
DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('users', 'timeZone'), ('users', 'initialRating'), ('users', 'ratingBand'), ('games', 'startingFen'),
      ('games', 'startPly'), ('games', 'moves'), ('games', 'analysisStatus'), ('games', 'openingName'),
      ('game_players', 'endedAt'), ('game_players', 'result'), ('game_players', 'opponentName'),
      ('game_players', 'headline'), ('game_players', 'momentsCount'), ('game_analyses', 'evals'),
      ('game_analyses', 'second'), ('game_analyses', 'lines'), ('player_reviews', 'content'),
      ('player_reviews', 'progress'), ('linked_accounts', 'ratings'), ('idempotency_keys', 'key')
    ) AS t(tbl, name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = col.tbl AND column_name = col.name) THEN
      missing := missing || format('%s.%s', col.tbl, col.name);
    END IF;
  END LOOP;
  FOR col IN
    SELECT * FROM (VALUES ('JobKind', 'EXTRACT_MISTAKES'), ('Judgement', 'BLUNDER'), ('Judgement', 'MISS'),
                          ('TimeClass', 'BLITZ'), ('AnalysisStatus', 'DONE')) AS t(typ, val)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                    WHERE t.typname = col.typ AND e.enumlabel = col.val) THEN
      missing := missing || format('enum %s.%s', col.typ, col.val);
    END IF;
  END LOOP;
  IF to_regclass('"game_players_userId_endedAt_gameId_idx"') IS NULL THEN
    missing := missing || 'index game_players_userId_endedAt_gameId_idx'::text;
  END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'M5 preconditions missing (phase-05 plan 2.3; apply M2/M3/M4 and m5a first): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MistakeSource" AS ENUM ('OWN_ERROR', 'MISSED_PUNISH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "GamePhase" AS ENUM ('OPENING', 'MIDDLEGAME', 'ENDGAME');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TrainingDeck" AS ENUM ('BANK', 'PUZZLE', 'OPENING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TrainingItemKind" AS ENUM ('MISTAKE', 'REVIEW_POSITION', 'LICHESS_PUZZLE', 'OPENING_LINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "CardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FsrsGrade" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SessionKind" AS ENUM ('DAILY', 'BANK', 'PUZZLES', 'WEAKNESS', 'PRACTICE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReportTarget" AS ENUM ('USER', 'GAME', 'MISTAKE', 'PUZZLE', 'LESSON', 'POSITION', 'COACH_MESSAGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReportReason" AS ENUM ('CHEATING', 'ABUSE', 'INAPPROPRIATE_NAME', 'WRONG_SOLUTION', 'BETTER_MOVE', 'ILLEGAL_MOVE', 'TEXT_WRONG', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "game_players" ADD COLUMN IF NOT EXISTS "bankVersion" SMALLINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "mistakes" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "epdHash" BIGINT NOT NULL,
    "color" CHAR(1) NOT NULL,
    "fen" VARCHAR(100) NOT NULL,
    "setupUci" VARCHAR(5),
    "solution" VARCHAR(120) NOT NULL,
    "accept" VARCHAR(60),
    "playedUci" VARCHAR(5) NOT NULL,
    "refuteUci" VARCHAR(5),
    "judgement" "Judgement" NOT NULL,
    "source" "MistakeSource" NOT NULL,
    "isPuzzle" BOOLEAN NOT NULL,
    "uniquenessGap" REAL,
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryTheme" VARCHAR(32) NOT NULL,
    "phase" "GamePhase" NOT NULL,
    "winBefore" REAL NOT NULL,
    "winAfterPlayed" REAL NOT NULL,
    "cpBest" INTEGER,
    "mateBest" SMALLINT,
    "timeClass" "TimeClass",
    "ecoCode" VARCHAR(3),
    "moveNumber" SMALLINT NOT NULL,
    "occurrences" SMALLINT NOT NULL DEFAULT 1,
    "lastGameId" BIGINT,
    "lastPly" SMALLINT,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL,
    "lastOpponentName" VARCHAR(40) NOT NULL,
    "texts" JSONB,
    "textVerifiedAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mistakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "mistake_occurrences" (
    "gameId" BIGINT NOT NULL,
    "ply" SMALLINT NOT NULL,
    "mistakeId" BIGINT NOT NULL,

    CONSTRAINT "mistake_occurrences_pkey" PRIMARY KEY ("gameId","ply")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "training_cards" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "deck" "TrainingDeck" NOT NULL,
    "kind" "TrainingItemKind" NOT NULL,
    "itemKey" VARCHAR(40) NOT NULL,
    "mistakeId" BIGINT,
    "puzzleId" VARCHAR(8),
    "openingId" BIGINT,
    "fen" VARCHAR(100),
    "solution" VARCHAR(120),
    "orient" CHAR(1),
    "puzzleRating" SMALLINT,
    "theme" VARCHAR(32) NOT NULL,
    "phase" "GamePhase",
    "due" TIMESTAMP(3) NOT NULL,
    "stability" REAL NOT NULL DEFAULT 0,
    "difficulty" REAL NOT NULL DEFAULT 0,
    "elapsedDays" SMALLINT NOT NULL DEFAULT 0,
    "scheduledDays" SMALLINT NOT NULL DEFAULT 0,
    "learningSteps" SMALLINT NOT NULL DEFAULT 0,
    "reps" SMALLINT NOT NULL DEFAULT 0,
    "lapses" SMALLINT NOT NULL DEFAULT 0,
    "state" "CardState" NOT NULL DEFAULT 'NEW',
    "lastReview" TIMESTAMP(3),
    "mastery" SMALLINT NOT NULL DEFAULT 0,
    "suspendedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "training_attempts" (
    "id" BIGSERIAL NOT NULL,
    "clientAttemptId" UUID NOT NULL,
    "userId" BIGINT NOT NULL,
    "cardId" BIGINT,
    "sessionId" BIGINT,
    "itemId" VARCHAR(8),
    "deck" "TrainingDeck" NOT NULL,
    "kind" "TrainingItemKind" NOT NULL,
    "puzzleId" VARCHAR(8),
    "puzzleRating" SMALLINT,
    "theme" VARCHAR(32) NOT NULL,
    "solved" BOOLEAN NOT NULL,
    "firstTry" BOOLEAN NOT NULL,
    "hintsUsed" SMALLINT NOT NULL DEFAULT 0,
    "wrongTries" SMALLINT NOT NULL DEFAULT 0,
    "wrongMoves" VARCHAR(60),
    "solutionShown" BOOLEAN NOT NULL DEFAULT false,
    "timeMs" INTEGER NOT NULL,
    "grade" "FsrsGrade",
    "suggestedGrade" "FsrsGrade",
    "state" "CardState",
    "stability" REAL,
    "difficulty" REAL,
    "elapsedDays" SMALLINT,
    "scheduledDays" SMALLINT,
    "ratingBefore" REAL,
    "ratingAfter" REAL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "training_sessions" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(24) NOT NULL,
    "filterKey" VARCHAR(64) NOT NULL,
    "theme" VARCHAR(32),
    "size" SMALLINT NOT NULL,
    "mix" BOOLEAN NOT NULL DEFAULT false,
    "countsTowardCap" BOOLEAN NOT NULL DEFAULT true,
    "items" JSONB NOT NULL,
    "day" DATE NOT NULL,
    "total" SMALLINT NOT NULL DEFAULT 0,
    "solved" SMALLINT NOT NULL DEFAULT 0,
    "firstTry" SMALLINT NOT NULL DEFAULT 0,
    "withHint" SMALLINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "training_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "training_days" (
    "userId" BIGINT NOT NULL,
    "day" DATE NOT NULL,
    "bankReviewed" SMALLINT NOT NULL DEFAULT 0,
    "newIntroduced" SMALLINT NOT NULL DEFAULT 0,
    "puzzlesDone" SMALLINT NOT NULL DEFAULT 0,
    "lessonsDone" SMALLINT NOT NULL DEFAULT 0,
    "activeMs" INTEGER NOT NULL DEFAULT 0,
    "plan" JSONB,
    "planDone" SMALLINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_days_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "theme_mastery" (
    "userId" BIGINT NOT NULL,
    "theme" VARCHAR(32) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstTry" INTEGER NOT NULL DEFAULT 0,
    "ewma" REAL NOT NULL DEFAULT 0,
    "bankCount" SMALLINT NOT NULL DEFAULT 0,
    "milestonePct" SMALLINT NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "theme_mastery_pkey" PRIMARY KEY ("userId","theme")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "training_profiles" (
    "userId" BIGINT NOT NULL,
    "puzzleRating" REAL NOT NULL DEFAULT 1500,
    "puzzleRd" REAL NOT NULL DEFAULT 350,
    "puzzleVol" REAL NOT NULL DEFAULT 0.06,
    "puzzleAttempts" INTEGER NOT NULL DEFAULT 0,
    "ratingSeeded" BOOLEAN NOT NULL DEFAULT false,
    "solveStreak" SMALLINT NOT NULL DEFAULT 0,
    "solveStreakBest" SMALLINT NOT NULL DEFAULT 0,
    "dayStreak" SMALLINT NOT NULL DEFAULT 0,
    "dayStreakBest" SMALLINT NOT NULL DEFAULT 0,
    "lastActiveDay" DATE,
    "lastWeaknessSeenVersion" INTEGER NOT NULL DEFAULT 0,
    "dayStartHour" SMALLINT NOT NULL DEFAULT 4,
    "releaseHour" SMALLINT NOT NULL DEFAULT 8,
    "bankDailyCap" SMALLINT NOT NULL DEFAULT 10,
    "newPerDay" SMALLINT NOT NULL DEFAULT 5,
    "autoGrade" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "reports" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reporterId" BIGINT,
    "targetType" "ReportTarget" NOT NULL,
    "targetRef" VARCHAR(64) NOT NULL,
    "reportedUserId" BIGINT,
    "fen" VARCHAR(100),
    "reason" "ReportReason" NOT NULL,
    "note" VARCHAR(500),
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" BIGINT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "mistakes_referenceId_key" ON "mistakes"("referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mistakes_userId_createdAt_idx" ON "mistakes"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "mistakes_userId_epdHash_key" ON "mistakes"("userId", "epdHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mistake_occurrences_mistakeId_idx" ON "mistake_occurrences"("mistakeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "training_cards_mistakeId_key" ON "training_cards"("mistakeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "training_cards_userId_deck_due_idx" ON "training_cards"("userId", "deck", "due");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "training_cards_userId_itemKey_key" ON "training_cards"("userId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "training_attempts_clientAttemptId_key" ON "training_attempts"("clientAttemptId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "training_attempts_userId_reviewedAt_idx" ON "training_attempts"("userId", "reviewedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "training_sessions_referenceId_key" ON "training_sessions"("referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "training_sessions_userId_startedAt_idx" ON "training_sessions"("userId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "reports_referenceId_key" ON "reports"("referenceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reports_targetType_targetRef_idx" ON "reports"("targetType", "targetRef");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "reports_reporterId_createdAt_idx" ON "reports"("reporterId", "createdAt" DESC);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "mistake_occurrences" ADD CONSTRAINT "mistake_occurrences_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "mistake_occurrences" ADD CONSTRAINT "mistake_occurrences_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "mistakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_cards" ADD CONSTRAINT "training_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_cards" ADD CONSTRAINT "training_cards_mistakeId_fkey" FOREIGN KEY ("mistakeId") REFERENCES "mistakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_attempts" ADD CONSTRAINT "training_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_days" ADD CONSTRAINT "training_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "theme_mastery" ADD CONSTRAINT "theme_mastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "training_profiles" ADD CONSTRAINT "training_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Raw SQL Prisma does not model (prisma/protected-indexes.txt; plan 6.5, 6.6) ────────────────────────────────────
-- Exclude recently seen puzzles at session build (W2/W3): `"userId" = $1 AND "puzzleId" = ANY($ids) AND "reviewedAt" >
-- $now - interval '90 days'`; bank attempts (puzzleId NULL) never enter the index.
CREATE INDEX IF NOT EXISTS training_attempts_puzzle_idx ON training_attempts ("userId", "puzzleId") WHERE "puzzleId" IS NOT NULL;
-- HOT updates: the counters change on every graded attempt, the primary keys never do.
ALTER TABLE training_days     SET (fillfactor = 80);
ALTER TABLE theme_mastery     SET (fillfactor = 80);
ALTER TABLE training_profiles SET (fillfactor = 80);
-- The session item lists and the frozen daily plans are JSON documents of a few KB.
ALTER TABLE training_sessions ALTER COLUMN items SET COMPRESSION lz4;
ALTER TABLE training_days     ALTER COLUMN plan  SET COMPRESSION lz4;
-- The worker role's grants live in packages/db/scripts/roles/replay_worker.p5.sql and the web role's in
-- replay_app.p5.sql (run per branch after the role exists), not here.
