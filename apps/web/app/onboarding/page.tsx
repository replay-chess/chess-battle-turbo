// /onboarding: the resolver (phase-04 plan §4.1, §8.1). Server; renders nothing on the v3 path, it redirects.
//
// - A finished member (entitled, admin or paywall off) continues to the destination (`?redirect_url=` or the
//   `rc_onb_next` cookie, else /games; D4-13). When their session token still says "not onboarded" and no rc_onb
//   cookie covers it, ClaimRefresh re-syncs the claims first, so middleware does not send them straight back here.
// - With `onboarding-v3` off, everyone else gets the legacy page (kept until the parity check, §12.6).
// - Otherwise: redirect to the step `resolveOnboardingRoute()` picks (the step is stored monotonically, so returning
//   at any time resumes where the member stopped).
// Cookies are only read here: middleware sets rc_onb_next (D4-29).
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ClaimRefresh } from "@/components/onboarding/ClaimRefresh";
import { requestNow } from "@/lib/api/now";
import { getViewer } from "@/lib/auth/viewer";
import { getOnboardingState, onboardingNext, toOnbViewer } from "@/lib/data/onboarding";
import { getFlags } from "@/lib/flags";
import { ONB_COOKIE, claimCookieSecret, verifyClaimCookie } from "@/lib/onboarding/claim-cookie";
import { entitledLike, resolveOnboardingRoute } from "@/lib/onboarding/resolve";
import { DEFAULT_DESTINATION } from "@/lib/onboarding/steps";
import { LegacyOnboarding } from "./_legacy/LegacyOnboarding";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** True when the session token (or a fresh rc_onb cookie) already says "onboarded". */
async function claimsSayOnboarded(nowMs: number): Promise<boolean> {
  const { userId, sessionClaims } = await auth();
  const md = (sessionClaims as { md?: { onboarded?: unknown } } | null)?.md;
  if (!md || typeof md !== "object") return true; // unknown claims: middleware does not gate on them either
  if (md.onboarded === true) return true;
  if (!userId) return false;
  const jar = await cookies();
  return verifyClaimCookie("onb", jar.get(ONB_COOKIE)?.value, userId, nowMs, claimCookieSecret());
}

export default async function OnboardingResolver({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in?redirect_url=%2Fonboarding");
  const sp = await searchParams;
  const [state, nowDate, next] = await Promise.all([
    getOnboardingState(viewer),
    requestNow(),
    onboardingNext(one(sp.redirect_url)),
  ]);
  if (!state) redirect("/sign-in");
  const now = nowDate.getTime();
  const onb = toOnbViewer(viewer, state, next);

  if (onb.onboardingDone && entitledLike(onb)) {
    const target = next ?? DEFAULT_DESTINATION;
    if (await claimsSayOnboarded(now)) redirect(target);
    return <ClaimRefresh next={target} />;
  }

  const flags = await getFlags(viewer);
  if (!flags["onboarding-v3"]) return <LegacyOnboarding />;
  redirect(resolveOnboardingRoute(onb, now));
}
