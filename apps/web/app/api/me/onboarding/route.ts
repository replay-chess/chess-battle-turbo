// ME-4 `PATCH /api/me/onboarding` (phase-04 plan §7.2, D4-15, D4-16, D4-25).
//
// - A step PATCH is one monotonic UPDATE … RETURNING (lib/data/onboarding.ts): the step never moves backwards, so a
//   retried, reordered or replayed request is harmless. Wire enums are lowercase; the DB keeps the uppercase enums.
// - `complete: true` needs DB entitlement (the request's viewer row: entitled, admin or paywall off), else
//   409 `conflict {reason: plan_required}`. It writes onboarded/onboardedAt/DONE, then awaits syncClerkClaims under a
//   3 s budget (retried in after() on timeout) and sets the 120 s HMAC cookie `rc_onb` that middleware honours until
//   the refreshed JWT says `onboarded` (no /games ↔ /onboarding bounce).
// - Rate limit `onboarding` 60/60 per user (registry entry).
import { onboardingEndpoints } from "@repo/contracts/http/registry";
import { fromWire } from "@repo/contracts/http/onboarding";
import { ApiError } from "@/lib/api/api-error";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import {
  completeOnboardingSql,
  getOnboardingState,
  patchOnboardingSql,
  providerSlugOf,
  runOnboardingWrite,
  type OnboardingPatch,
} from "@/lib/data/onboarding";
import { claimCookieSecret, claimSetCookie, cookieSecureFor, signClaimCookie } from "@/lib/onboarding/claim-cookie";
import { captureOnboardingServerEvent } from "@/lib/onboarding/server-events";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** syncClerkClaims budget inside the request (D4-16); the rest happens in after(). */
const CLAIMS_SYNC_BUDGET_MS = 3_000;

async function syncClaimsWithin(userId: bigint, ms: number): Promise<boolean> {
  const { syncClerkClaims } = await import("@/lib/auth/claims");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([syncClerkClaims(userId).then(() => true as const), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const PATCH = route(onboardingEndpoints.patch, async (ctx) => {
  // auth "user": route() answered 401 already when there is no viewer.
  const viewer = ctx.viewer!;
  const body = ctx.body;

  if (body.complete) {
    if (!viewer.entitlement.member) throw new ApiError("conflict", { details: { reason: "plan_required" } });
    const result = await runOnboardingWrite(rawDb(prisma), completeOnboardingSql(viewer.id, body.timeZone));
    if (!result) throw new ApiError("unauthorized");
    ctx.timing.mark("write");

    const synced = await syncClaimsWithin(viewer.id, CLAIMS_SYNC_BUDGET_MS);
    if (!synced) {
      ctx.after(async () => {
        const { syncClerkClaims } = await import("@/lib/auth/claims");
        await syncClerkClaims(viewer.id);
      });
    }
    ctx.timing.mark("claims");

    const headers: Record<string, string> = {};
    const secret = claimCookieSecret();
    if (secret && ctx.clerkUserId) {
      const value = await signClaimCookie("onb", ctx.clerkUserId, ctx.now.getTime(), secret);
      headers["Set-Cookie"] = claimSetCookie("onb", value, { secure: cookieSecureFor(ctx.req.url) });
    }

    const isTrial = viewer.entitlement.trial.active;
    const ref = viewer.ref;
    ctx.after(async () => {
      const state = await getOnboardingState(viewer);
      const linked = [...new Set((state?.accounts ?? []).map(providerSlugOf))];
      await captureOnboardingServerEvent("onb_completed_server", { is_trial: isTrial, linked_providers: linked }, ref);
    });

    return respondWith({ onboarding: result.view, timeZone: result.timeZone }, { headers });
  }

  const patch: OnboardingPatch = {};
  if (body.step) patch.step = fromWire(body.step) as OnboardingPatch["step"];
  if (body.ratingBand !== undefined) patch.ratingBand = body.ratingBand === null ? null : fromWire(body.ratingBand);
  if (body.ratingBandSource !== undefined) patch.ratingBandSource = body.ratingBandSource;
  if (body.initialRating !== undefined) patch.initialRating = body.initialRating;
  if (body.goals !== undefined) patch.goals = body.goals.map((g) => fromWire(g));
  if (body.dailyMinutes !== undefined) patch.dailyMinutes = body.dailyMinutes;
  if (body.timeZone !== undefined) patch.timeZone = body.timeZone;

  const result = await runOnboardingWrite(rawDb(prisma), patchOnboardingSql(viewer.id, patch));
  if (!result) throw new ApiError("unauthorized");
  return { onboarding: result.view, timeZone: result.timeZone };
});
