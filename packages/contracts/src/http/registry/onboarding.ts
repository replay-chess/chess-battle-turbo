import { defineEndpoint } from "../endpoint";
import { PatchOnboardingBody, PatchOnboardingData } from "../onboarding";

/** ME-4 rate limit (phase-04 §7.0). */
export const ONBOARDING_LIMIT = { bucket: "onboarding", limit: 60, windowSec: 60, by: "user" } as const;

/** Phase-04 plan §7.2. Handler: WEB/app/api/me/onboarding/route.ts (WP-F). */
export const onboardingEndpoints = {
  /**
   * ME-4. One monotonic UPDATE per step (the step never moves backwards); `complete: true` needs DB entitlement
   * (409 `plan_required`), awaits syncClerkClaims (3 s) and sets the 120 s `rc_onb` cookie (D4-16).
   */
  patch: defineEndpoint({
    id: "me.onboarding",
    method: "PATCH",
    path: "/api/me/onboarding",
    auth: "user",
    class: "W1",
    cache: "no-store",
    rateLimit: ONBOARDING_LIMIT,
    body: PatchOnboardingBody,
    response: PatchOnboardingData,
    errors: ["conflict"],
    maxBodyBytes: 2_048,
    summary: "Saves an onboarding step, or completes onboarding",
  }),
} as const;
