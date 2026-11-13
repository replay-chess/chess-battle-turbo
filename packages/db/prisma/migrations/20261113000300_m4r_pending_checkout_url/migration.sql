-- m4r (phase-04 FIX-2, billing review round 2): the open checkout's Dodo URL, so a second checkout for the same plan
-- within the pending-checkout window (30 min) reuses the open session instead of opening a second trial session
-- (plan §3 row 190 / api-design BIL-1 "Reuses pendingCheckoutSessionId < 30 min for the same plan"; the session id
-- alone cannot be turned back into its page: Dodo's session retrieve returns no checkout_url).
--
-- Additive and nullable: no default, no rewrite, no index. Cleared with the other pendingCheckout* columns when the
-- member becomes entitled (lib/billing/fanout.ts CLEAR_PENDING_SQL). Apply with `prisma migrate deploy`.

SET lock_timeout = '5s';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingCheckoutUrl" VARCHAR(512);
