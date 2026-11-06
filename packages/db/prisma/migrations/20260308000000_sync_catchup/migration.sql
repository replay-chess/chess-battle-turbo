-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "MatchmakingStatus" AS ENUM ('SEARCHING', 'MATCHED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('LOBBY', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentMode" AS ENUM ('OPENING', 'LEGEND', 'ENDGAME', 'FREE');

-- AlterTable
ALTER TABLE "chess_com_profiles" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "followers" INTEGER,
ADD COLUMN     "isStreamer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "joined" TIMESTAMP(3),
ADD COLUMN     "status" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "games" ADD COLUMN     "tournamentId" BIGINT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "openings" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "eco" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pgn" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "sideToMove" TEXT NOT NULL,
    "moveCount" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matchmaking_queue" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "rating" INTEGER,
    "timeControlType" TEXT NOT NULL,
    "legendReferenceId" TEXT,
    "openingReferenceId" TEXT,
    "timeControlSeconds" INTEGER NOT NULL,
    "incrementSeconds" INTEGER NOT NULL,
    "status" "MatchmakingStatus" NOT NULL DEFAULT 'SEARCHING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "matchedGameRef" TEXT,

    CONSTRAINT "matchmaking_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "mode" "TournamentMode" NOT NULL,
    "status" "TournamentStatus" NOT NULL DEFAULT 'LOBBY',
    "maxParticipants" INTEGER,
    "initialTimeSeconds" INTEGER NOT NULL,
    "incrementSeconds" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "openingId" BIGINT,
    "legendId" BIGINT,
    "chessPositionId" BIGINT,
    "createdByUserId" BIGINT NOT NULL,
    "scheduledStartAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_participants" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "userId" BIGINT NOT NULL,
    "points" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "isSearching" BOOLEAN NOT NULL DEFAULT false,
    "searchingSince" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tournament_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "openings_referenceId_key" ON "openings"("referenceId");

-- CreateIndex
CREATE INDEX "openings_eco_idx" ON "openings"("eco");

-- CreateIndex
CREATE INDEX "openings_name_idx" ON "openings"("name");

-- CreateIndex
CREATE INDEX "openings_isActive_idx" ON "openings"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "openings_eco_name_pgn_key" ON "openings"("eco", "name", "pgn");

-- CreateIndex
CREATE UNIQUE INDEX "matchmaking_queue_referenceId_key" ON "matchmaking_queue"("referenceId");

-- CreateIndex
CREATE INDEX "matchmaking_queue_userId_idx" ON "matchmaking_queue"("userId");

-- CreateIndex
CREATE INDEX "matchmaking_queue_status_timeControlSeconds_incrementSecond_idx" ON "matchmaking_queue"("status", "timeControlSeconds", "incrementSeconds", "rating");

-- CreateIndex
CREATE INDEX "matchmaking_queue_expiresAt_idx" ON "matchmaking_queue"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_referenceId_key" ON "tournaments"("referenceId");

-- CreateIndex
CREATE INDEX "tournaments_referenceId_idx" ON "tournaments"("referenceId");

-- CreateIndex
CREATE INDEX "tournaments_status_idx" ON "tournaments"("status");

-- CreateIndex
CREATE INDEX "tournaments_createdByUserId_idx" ON "tournaments"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_referenceId_key" ON "tournament_participants"("referenceId");

-- CreateIndex
CREATE INDEX "tournament_participants_tournamentId_points_idx" ON "tournament_participants"("tournamentId", "points" DESC);

-- CreateIndex
CREATE INDEX "tournament_participants_userId_idx" ON "tournament_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_participants_tournamentId_userId_key" ON "tournament_participants"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "chess_positions_fen_key" ON "chess_positions"("fen");

-- CreateIndex
CREATE INDEX "games_tournamentId_idx" ON "games"("tournamentId");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matchmaking_queue" ADD CONSTRAINT "matchmaking_queue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "openings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_legendId_fkey" FOREIGN KEY ("legendId") REFERENCES "legends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_chessPositionId_fkey" FOREIGN KEY ("chessPositionId") REFERENCES "chess_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_participants" ADD CONSTRAINT "tournament_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

