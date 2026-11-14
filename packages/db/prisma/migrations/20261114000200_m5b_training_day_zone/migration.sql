-- m5b (Phase 5, FIX-1): the zone and day-start hour a training day was opened in (phase-05 plan §8.10 "a time-zone
-- change keeps the row keyed by the day it was created", §7.3 W8 "a dayStartHour change takes effect from the next
-- local day", §12.2 R1 "time-zone change keeps today's row"). The day in progress stays the day it started as until
-- it ends in that zone (`@repo/chess-training/day` trainingDayAt), so a zone change mid-day cannot give back the used
-- bank cap, rebuild the plan or add a streak day. NULL on rows written before this migration: such a row is read as
-- opened in the member's current zone (no pin), which is what every reader did before.
-- Expand-only and metadata-only (two nullable columns, no default, no rewrite, no index); lock_timeout bounds the
-- brief ACCESS EXCLUSIVE lock on training_days. Rollback: stop writing the columns. Apply with `prisma migrate deploy`
-- only (never `prisma db push`, never `prisma migrate dev` against Neon). Role grants on training_days are
-- table-level (replay_app.p5.sql, replay_worker.p5.sql SELECT), so they cover the new columns.
SET lock_timeout = '5s';

ALTER TABLE "training_days" ADD COLUMN IF NOT EXISTS "timeZone" VARCHAR(64);
ALTER TABLE "training_days" ADD COLUMN IF NOT EXISTS "dayStartHour" SMALLINT;
