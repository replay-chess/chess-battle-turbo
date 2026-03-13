-- AlterTable
ALTER TABLE "games" ADD COLUMN     "openingId" BIGINT;

-- CreateIndex
CREATE INDEX "games_openingId_idx" ON "games"("openingId");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_openingId_fkey" FOREIGN KEY ("openingId") REFERENCES "openings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
