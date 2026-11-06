-- AlterTable (additive only; safe with prisma migrate deploy)
ALTER TABLE "users" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
