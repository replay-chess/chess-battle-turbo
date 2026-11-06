-- AlterTable
ALTER TABLE "chess_positions" ADD COLUMN     "blackPlayerId" BIGINT,
ADD COLUMN     "whitePlayerId" BIGINT;

-- CreateTable
CREATE TABLE "legends" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "era" TEXT NOT NULL,
    "profilePhotoUrl" TEXT,
    "peakRating" INTEGER,
    "nationality" TEXT,
    "shortDescription" VARCHAR(500) NOT NULL,
    "playingStyle" TEXT,
    "birthYear" INTEGER,
    "deathYear" INTEGER,
    "achievements" JSONB,
    "famousGames" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "legends_referenceId_key" ON "legends"("referenceId");

-- CreateIndex
CREATE INDEX "legends_name_idx" ON "legends"("name");

-- CreateIndex
CREATE INDEX "legends_isActive_idx" ON "legends"("isActive");


-- CreateIndex
CREATE INDEX "chess_positions_whitePlayerId_idx" ON "chess_positions"("whitePlayerId");

-- CreateIndex
CREATE INDEX "chess_positions_blackPlayerId_idx" ON "chess_positions"("blackPlayerId");

-- AddForeignKey
ALTER TABLE "chess_positions" ADD CONSTRAINT "chess_positions_whitePlayerId_fkey" FOREIGN KEY ("whitePlayerId") REFERENCES "legends"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chess_positions" ADD CONSTRAINT "chess_positions_blackPlayerId_fkey" FOREIGN KEY ("blackPlayerId") REFERENCES "legends"("id") ON DELETE SET NULL ON UPDATE CASCADE;
