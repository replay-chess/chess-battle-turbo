/*
  Warnings:

  - Added the required column `startingFen` to the `games` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "games" ADD COLUMN     "chessPositionId" BIGINT,
ADD COLUMN     "startingFen" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "games_chessPositionId_idx" ON "games"("chessPositionId");
