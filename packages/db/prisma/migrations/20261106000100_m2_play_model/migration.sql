-- M2 (Phase 2): the typed play model (phase-02 plan 6.1-6.4).
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
-- --shadow-database-url <local Docker Postgres 17> --script`, then hand-edited:
--   * lock_timeout guards the ALTER TABLE on games;
--   * the raw SQL block at the end (partial indexes, fillfactor, lz4) is what Prisma does not model. Its index
--     names are listed in prisma/protected-indexes.txt, so scripts/db/check-drift.ts ignores their DROP INDEX lines.
-- Expand-only: 7 enums, 31 nullable or defaulted columns on games (metadata-only on PostgreSQL >= 11, no rewrite),
-- 3 FKs on brand-new all-NULL columns (validation is instant, NOT VALID is not needed), game_players, indexes.
-- Apply with `prisma migrate deploy` only. Never `prisma db push` (it drops the partial indexes and the storage
-- parameters) and never `prisma migrate dev` against Neon.

SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('LEGEND_BOT', 'BOT', 'FRIEND', 'ONLINE', 'TOURNAMENT', 'IMPORTED');

-- CreateEnum
CREATE TYPE "GameSource" AS ENUM ('REPLAY', 'CHESSCOM', 'LICHESS');

-- CreateEnum
CREATE TYPE "TimeClass" AS ENUM ('BULLET', 'BLITZ', 'RAPID', 'CLASSICAL', 'DAILY', 'UNTIMED');

-- CreateEnum
CREATE TYPE "GameEndMethod" AS ENUM ('CHECKMATE', 'RESIGNATION', 'TIMEOUT', 'TIMEOUT_VS_INSUFFICIENT', 'STALEMATE', 'THREEFOLD', 'FIFTY_MOVE', 'INSUFFICIENT_MATERIAL', 'AGREEMENT', 'ABANDONED', 'ABORTED', 'OTHER');

-- CreateEnum
CREATE TYPE "GameWinner" AS ENUM ('WHITE', 'BLACK', 'DRAW', 'NONE');

-- CreateEnum
CREATE TYPE "LivePhase" AS ENUM ('WAITING', 'STUDY', 'FIRST_MOVE', 'PLAYING', 'ENDED');

-- CreateEnum
CREATE TYPE "PlayerResult" AS ENUM ('WIN', 'LOSS', 'DRAW', 'ABORTED');

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "blackName" VARCHAR(40),
ADD COLUMN     "blackPlayerId" BIGINT,
ADD COLUMN     "blackRating" SMALLINT,
ADD COLUMN     "blackTimeMs" INTEGER,
ADD COLUMN     "blackTitle" VARCHAR(4),
ADD COLUMN     "botElo" SMALLINT,
ADD COLUMN     "clockRunning" CHAR(1),
ADD COLUMN     "endMethod" "GameEndMethod",
ADD COLUMN     "externalId" VARCHAR(40),
ADD COLUMN     "externalUrl" VARCHAR(120),
ADD COLUMN     "fen" TEXT,
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "mode" "GameMode",
ADD COLUMN     "moveClocksMs" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "moves" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "outcome" "GameWinner",
ADD COLUMN     "pgn" TEXT,
ADD COLUMN     "phase" "LivePhase",
ADD COLUMN     "phaseEndsAt" TIMESTAMP(3),
ADD COLUMN     "plyCount" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "rated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rematchOfId" BIGINT,
ADD COLUMN     "source" "GameSource" NOT NULL DEFAULT 'REPLAY',
ADD COLUMN     "startPly" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "studySeconds" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "timeClass" "TimeClass",
ADD COLUMN     "whiteName" VARCHAR(40),
ADD COLUMN     "whitePlayerId" BIGINT,
ADD COLUMN     "whiteRating" SMALLINT,
ADD COLUMN     "whiteTimeMs" INTEGER,
ADD COLUMN     "whiteTitle" VARCHAR(4);

-- CreateTable
CREATE TABLE "game_players" (
    "gameId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "color" CHAR(1) NOT NULL,
    "mode" "GameMode" NOT NULL,
    "timeClass" "TimeClass",
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "result" "PlayerResult",
    "endedAt" TIMESTAMP(3),
    "opponentUserId" BIGINT,
    "opponentName" VARCHAR(40) NOT NULL DEFAULT '',
    "opponentRating" SMALLINT,
    "ratingBefore" SMALLINT,
    "ratingAfter" SMALLINT,
    "ratingDelta" SMALLINT,
    "tournamentId" BIGINT,
    "source" "GameSource" NOT NULL DEFAULT 'REPLAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("gameId","userId")
);

-- CreateIndex
CREATE INDEX "game_players_userId_endedAt_gameId_idx" ON "game_players"("userId", "endedAt" DESC, "gameId" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "game_players_gameId_color_key" ON "game_players"("gameId", "color");

-- CreateIndex
CREATE UNIQUE INDEX "games_source_externalId_key" ON "games"("source", "externalId");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_whitePlayerId_fkey" FOREIGN KEY ("whitePlayerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_blackPlayerId_fkey" FOREIGN KEY ("blackPlayerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_rematchOfId_fkey" FOREIGN KEY ("rematchOfId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Raw SQL (phase-02 plan 6.3) ──────────────────────────────────────────────────────────────────────────────
-- Sparse FK columns followed by ON DELETE SET NULL from users/games get partial indexes (data-model §2.9).
CREATE INDEX IF NOT EXISTS games_white_player_idx ON games ("whitePlayerId") WHERE "whitePlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_black_player_idx ON games ("blackPlayerId") WHERE "blackPlayerId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_rematch_of_idx   ON games ("rematchOfId")   WHERE "rematchOfId"   IS NOT NULL;
-- Open games only (dozens of rows): the socket restore list and the sweeps (plan 6.6.8). Not on lastMoveAt, which
-- every checkpoint changes; an index on it would turn each of the ≈ 10 checkpoint UPDATEs per game into a non-HOT
-- update.
CREATE INDEX IF NOT EXISTS games_open_idx ON games (status) WHERE status IN ('WAITING_FOR_OPPONENT', 'IN_PROGRESS');
-- Leave room on each page for HOT updates of the checkpointed row (affects new pages only; no rewrite).
ALTER TABLE games SET (fillfactor = 90);
-- Storage parameters Prisma does not model (no drift). Applies to newly written values only; no rewrite.
ALTER TABLE games ALTER COLUMN moves SET COMPRESSION lz4;
ALTER TABLE games ALTER COLUMN pgn   SET COMPRESSION lz4;
