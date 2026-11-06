-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'GAME_STAKE', 'GAME_WIN', 'GAME_DRAW_REFUND', 'PLATFORM_FEE', 'GAME_EXPIRED_REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('WAITING_FOR_OPPONENT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GameResult" AS ENUM ('CREATOR_WON', 'OPPONENT_WON', 'DRAW', 'CREATOR_TIMEOUT', 'OPPONENT_TIMEOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profilePictureUrl" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "balance" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "lockedAmount" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "gameId" BIGINT,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(19,2) NOT NULL,
    "balanceAfter" DECIMAL(19,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "creatorId" BIGINT NOT NULL,
    "opponentId" BIGINT,
    "stakeAmount" DECIMAL(19,2) NOT NULL,
    "totalPot" DECIMAL(19,2) NOT NULL,
    "platformFeePercentage" DECIMAL(5,2) NOT NULL,
    "platformFeeAmount" DECIMAL(19,2) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'WAITING_FOR_OPPONENT',
    "result" "GameResult",
    "winnerId" BIGINT,
    "initialTimeSeconds" INTEGER NOT NULL,
    "incrementSeconds" INTEGER NOT NULL,
    "creatorTimeRemaining" INTEGER NOT NULL,
    "opponentTimeRemaining" INTEGER NOT NULL,
    "lastMoveAt" TIMESTAMP(3),
    "gameData" JSONB,
    "inviteCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_stats" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "totalGamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "gamesWon" INTEGER NOT NULL DEFAULT 0,
    "gamesLost" INTEGER NOT NULL DEFAULT 0,
    "gamesDrawn" INTEGER NOT NULL DEFAULT 0,
    "totalMoneyWon" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "totalMoneyLost" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "totalPlatformFeesPaid" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(19,2) NOT NULL DEFAULT 0,
    "currentWinStreak" INTEGER NOT NULL DEFAULT 0,
    "longestWinStreak" INTEGER NOT NULL DEFAULT 0,
    "averageGameDuration" INTEGER,
    "lastPlayedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_referenceId_key" ON "users"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_googleId_idx" ON "users"("googleId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_code_idx" ON "users"("code");

-- CreateIndex
CREATE INDEX "users_referenceId_idx" ON "users"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_referenceId_key" ON "wallets"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_referenceId_idx" ON "wallets"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_referenceId_key" ON "transactions"("referenceId");

-- CreateIndex
CREATE INDEX "transactions_userId_idx" ON "transactions"("userId");

-- CreateIndex
CREATE INDEX "transactions_gameId_idx" ON "transactions"("gameId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_referenceId_idx" ON "transactions"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "games_referenceId_key" ON "games"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "games_inviteCode_key" ON "games"("inviteCode");

-- CreateIndex
CREATE INDEX "games_creatorId_idx" ON "games"("creatorId");

-- CreateIndex
CREATE INDEX "games_opponentId_idx" ON "games"("opponentId");

-- CreateIndex
CREATE INDEX "games_winnerId_idx" ON "games"("winnerId");

-- CreateIndex
CREATE INDEX "games_inviteCode_idx" ON "games"("inviteCode");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "games"("status");

-- CreateIndex
CREATE INDEX "games_expiresAt_idx" ON "games"("expiresAt");

-- CreateIndex
CREATE INDEX "games_referenceId_idx" ON "games"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_stats_referenceId_key" ON "user_stats"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_stats_userId_key" ON "user_stats"("userId");

-- CreateIndex
CREATE INDEX "user_stats_userId_idx" ON "user_stats"("userId");

-- CreateIndex
CREATE INDEX "user_stats_referenceId_idx" ON "user_stats"("referenceId");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
