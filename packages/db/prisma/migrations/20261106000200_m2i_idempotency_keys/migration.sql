-- M2i (Phase 2): idempotency_keys (phase-02 plan 6.1/6.2; P1 did not create it, checked at WP-A start).
-- Header-key idempotency for POST /api/games and later create endpoints (api-design §2.8). Rows are kept 24 h
-- (the daily cron prunes WHERE "createdAt" < now() - interval '24 hours'). New table only.
-- Apply with `prisma migrate deploy` only.

SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "userId" BIGINT NOT NULL,
    "key" VARCHAR(36) NOT NULL,
    "route" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "status" SMALLINT NOT NULL,
    "responseStatus" SMALLINT,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");
