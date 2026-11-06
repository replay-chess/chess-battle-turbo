-- AlterTable
ALTER TABLE "users" ADD COLUMN "dodoCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_dodoCustomerId_key" ON "users"("dodoCustomerId");

-- CreateIndex
CREATE INDEX "users_dodoCustomerId_idx" ON "users"("dodoCustomerId");
