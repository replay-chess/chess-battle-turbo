-- AlterTable (additive only; safe with prisma migrate deploy and prisma db push)
ALTER TABLE "users" ADD COLUMN "plan" TEXT;
ALTER TABLE "users" ADD COLUMN "planInterval" TEXT;
ALTER TABLE "users" ADD COLUMN "subscriptionId" TEXT;
ALTER TABLE "users" ADD COLUMN "subscriptionStatus" TEXT;
ALTER TABLE "users" ADD COLUMN "subscriptionProductId" TEXT;
ALTER TABLE "users" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "subscriptionUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_subscriptionId_key" ON "users"("subscriptionId");

-- CreateIndex
CREATE INDEX "users_subscriptionStatus_idx" ON "users"("subscriptionStatus");
