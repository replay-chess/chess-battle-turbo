-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboarded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "chess_com_profiles" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "chessComHandle" TEXT NOT NULL,
    "rapidRating" INTEGER,
    "rapidBestRating" INTEGER,
    "rapidWins" INTEGER,
    "rapidLosses" INTEGER,
    "rapidDraws" INTEGER,
    "blitzRating" INTEGER,
    "blitzBestRating" INTEGER,
    "blitzWins" INTEGER,
    "blitzLosses" INTEGER,
    "blitzDraws" INTEGER,
    "bulletRating" INTEGER,
    "bulletBestRating" INTEGER,
    "bulletWins" INTEGER,
    "bulletLosses" INTEGER,
    "bulletDraws" INTEGER,
    "dailyRating" INTEGER,
    "dailyBestRating" INTEGER,
    "dailyWins" INTEGER,
    "dailyLosses" INTEGER,
    "dailyDraws" INTEGER,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chess_com_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chess_com_profiles_referenceId_key" ON "chess_com_profiles"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "chess_com_profiles_userId_key" ON "chess_com_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chess_com_profiles_chessComHandle_key" ON "chess_com_profiles"("chessComHandle");

-- CreateIndex
CREATE INDEX "chess_com_profiles_userId_idx" ON "chess_com_profiles"("userId");

-- CreateIndex
CREATE INDEX "chess_com_profiles_chessComHandle_idx" ON "chess_com_profiles"("chessComHandle");

-- CreateIndex
CREATE INDEX "chess_com_profiles_referenceId_idx" ON "chess_com_profiles"("referenceId");

-- AddForeignKey
ALTER TABLE "chess_com_profiles" ADD CONSTRAINT "chess_com_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
