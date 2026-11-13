// The two legacy Chess.com endpoints, POST /api/user/chess-com-profile and POST /api/user/chess-com-profile/preview
// (phase-04 plan §3 rows 179-180, §7.12: removed at DoD, kept until the §12.6 parity check). Their only callers are
// the legacy onboarding page (served while `onboarding-v3` is off) and the profile page's ChessComConnectModal (served
// while `import-v3` is off). FIX-2 (round-2 review): FIX-1 gated only /api/user/onboarding-skip, so with v3 on a
// non-member could still POST the profile route and get `users.onboarded = true` without the plan step (§11.1
// plan_required), and both routes looped Chess.com lookups with no rate limit (§11.2).
//
// The rules:
//   - not served (404, like every step route of the other flow) once neither caller is: both v3 flags on;
//   - the profile route writes `onboarded = true` only for the legacy onboarding page, i.e. while `onboarding-v3` is
//     off; with it on, PATCH /api/me/onboarding {complete} (409 plan_required for a non-member) is the only way to
//     finish onboarding, so the profile modal links the account and leaves onboarding alone (plan §3 row 180:
//     "without the onboarded write");
//   - every served request spends ACC-2's lookup buckets (10 / 60 s per user, 30 / 60 s per IP) before it calls
//     Chess.com, the same buckets as the v3 lookup and the Confirm preview.
import type { FlagValues } from "@/lib/flags";
import { isApiError } from "@/lib/api/api-error";
import { limitConfirmLookup, type LimitCheck } from "@/lib/onboarding/confirm-limit";
import type { RateLimitSubject } from "@/lib/rate-limit-db";

export type LegacyChessComFlags = Pick<FlagValues, "onboarding-v3" | "import-v3">;

export type LegacyChessComDecision = { kind: "not_found" } | { kind: "serve"; markOnboarded: boolean };

export function legacyChessComDecision(flags: LegacyChessComFlags): LegacyChessComDecision {
  const v3Onboarding = flags["onboarding-v3"] === true;
  if (v3Onboarding && flags["import-v3"] === true) return { kind: "not_found" };
  return { kind: "serve", markOnboarded: !v3Onboarding };
}

/** The JSON 404 the other legacy route answers (lib/onboarding/legacy-skip.ts). */
export const LEGACY_NOT_FOUND_BODY = { error: { code: "not_found", message: "Not found." } } as const;

export type LegacyLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

/** Spends the lookup buckets; a denial is returned (the legacy routes answer their own 429), anything else throws. */
export async function limitLegacyLookup(subject: RateLimitSubject, check?: LimitCheck): Promise<LegacyLimitResult> {
  try {
    await limitConfirmLookup(subject, check);
    return { allowed: true };
  } catch (err) {
    if (isApiError(err) && err.code === "rate_limited") {
      return { allowed: false, retryAfterSec: Math.max(1, err.retryAfterSec ?? 60) };
    }
    throw err;
  }
}
