-- CreateTable
CREATE TABLE "chess_positions" (
    "id" BIGSERIAL NOT NULL,
    "referenceId" TEXT NOT NULL,
    "fen" TEXT NOT NULL,
    "sideToMove" TEXT NOT NULL,
    "pgn" TEXT,
    "moveNumber" INTEGER,
    "whitePlayerName" TEXT,
    "blackPlayerName" TEXT,
    "whitePlayerMetadata" JSONB,
    "blackPlayerMetadata" JSONB,
    "tournamentName" TEXT,
    "eventDate" TIMESTAMP(3),
    "gameMetadata" JSONB,
    "positionType" TEXT,
    "positionContext" JSONB,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourceMetadata" JSONB,
    "timesPlayed" INTEGER NOT NULL DEFAULT 0,
    "popularityScore" DOUBLE PRECISION,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chess_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chess_positions_referenceId_key" ON "chess_positions"("referenceId");

-- CreateIndex
CREATE INDEX "chess_positions_referenceId_idx" ON "chess_positions"("referenceId");

-- CreateIndex
CREATE INDEX "chess_positions_sourceType_idx" ON "chess_positions"("sourceType");

-- CreateIndex
CREATE INDEX "chess_positions_featured_idx" ON "chess_positions"("featured");

-- CreateIndex
CREATE INDEX "chess_positions_isActive_idx" ON "chess_positions"("isActive");
