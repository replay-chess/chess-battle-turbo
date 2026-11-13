// The Confirm step's Chess.com preview spends the same rate-limit buckets as ACC-2 `POST /api/accounts/chesscom/lookup`
// (phase-04 plan §7.0, §11.2: per-user AND per-IP buckets apply to lookups). The page reads profile + stats + archives
// for any `u` in its URL, so without this a signed-in user could loop `/onboarding/confirm?u=<new handle>` and spend
// four upstream calls per load (Vercel's egress, and through the worker fallback the import gate). FIX-1.
//
// A denied check throws 429 `rate_limited`, which the page shows as its "didn't answer" card (Check Again retries).
import { ACCOUNT_LOOKUP_LIMITS } from "@repo/contracts/http/accounts";
import { ApiError } from "@/lib/api/api-error";
import type { RateLimitDecision, RateLimitSubject } from "@/lib/rate-limit-db";

export type LimitCheck = (specs: typeof CONFIRM_LOOKUP_LIMITS, subject: RateLimitSubject) => Promise<RateLimitDecision>;

/** The lookup's own buckets: 10 / 60 s per user, 30 / 60 s per IP. */
export const CONFIRM_LOOKUP_LIMITS = [...ACCOUNT_LOOKUP_LIMITS];

export async function limitConfirmLookup(subject: RateLimitSubject, check?: LimitCheck): Promise<void> {
  const run: LimitCheck = check ?? (async (specs, s) => (await import("@/lib/rate-limit-db")).checkRateLimit(specs, s));
  const decision = await run(CONFIRM_LOOKUP_LIMITS, subject);
  if (!decision.allowed) {
    throw new ApiError("rate_limited", {
      retryAfterSec: Math.max(1, decision.retryAfterSec),
      details: { bucket: decision.bucket ?? CONFIRM_LOOKUP_LIMITS[0]!.bucket },
    });
  }
}
