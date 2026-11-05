-- M1 (Phase 1): rate limiter tables, webhook idempotency, billing compare-and-set key, games version.
-- Generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
-- against a throwaway shadow database, then hand-edited:
--   * rate_limit_buckets is UNLOGGED (Prisma does not model storage parameters, so this causes no drift).
--   * lock_timeout guards the ALTER TABLE on users.
-- Additive only. Apply with `prisma migrate deploy`; never with `prisma db push` (it would recreate
-- rate_limit_buckets as a LOGGED table) and never with `prisma migrate dev` against a shared database.

SET lock_timeout = '5s';

-- CreateTable (UNLOGGED: burst windows <= 300 s only; Neon empties it when the compute restarts)
CREATE UNLOGGED TABLE "rate_limit_buckets" (
    "key" VARCHAR(120) NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable (LOGGED: durable windows > 300 s)
CREATE TABLE "rate_limit_windows" (
    "key" VARCHAR(120) NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "provider" VARCHAR(16) NOT NULL,
    "eventId" VARCHAR(100) NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "eventTime" TIMESTAMP(3),
    "userId" BIGINT,
    "status" VARCHAR(16),
    "error" VARCHAR(500),
    "payload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("provider","eventId")
);

-- AlterTable: both are metadata-only on PostgreSQL >= 11 (nullable column; constant default), so the
-- ACCESS EXCLUSIVE lock is brief and there is no table rewrite. No backfill: existing rows keep
-- subscriptionSourceAt = NULL and the billing rules fall back to subscriptionUpdatedAt for them.
ALTER TABLE "users" ADD COLUMN "subscriptionSourceAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "gamesVersion" INTEGER NOT NULL DEFAULT 0;
