// Viewer guards outside route() (plan §8.3, CDL §2.4, API §2.11.2). route({ auth }) is the API gate; these are the
// same decisions for server components, server actions and services (P2+):
//
//   const viewer = await requireMember();              // throws ApiError 401 / 402 { reason, upgradeUrl }
//   const viewer = await requireMemberPage();          // pages: redirects instead (lib/auth/require-member-page.ts)
//
// The decision functions are pure (guards.test.ts); only requireViewer/requireMember touch the request (getViewer).
import { ApiError } from "../api/api-error";
import { paywallUrlFor, reasonFor, upgradeUrlFor } from "./membership";
import type { Viewer } from "./viewer";

export type MemberGateOptions = {
  /**
   * B26 (decide before P3): lapsed members may read (GET) what they made while subscribed. Default false: the hard
   * redirect / 402 of P1.
   */
  allowLapsedRead?: boolean;
};

type GateViewer = Pick<Viewer, "entitlement"> & { billing?: Partial<Viewer["billing"]> };

/** True when the viewer passes the member gate (entitled, admin or paywall off; optionally lapsed read). */
export function passesMemberGate(viewer: GateViewer, options: MemberGateOptions = {}): boolean {
  if (viewer.entitlement.member) return true;
  return Boolean(options.allowLapsedRead) && viewer.entitlement.state === "lapsed";
}

/** The 402 a non-member gets (plan §7.1: `details.reason` + `upgradeUrl`). */
export function memberDenial(viewer: GateViewer): ApiError {
  const reason = reasonFor(viewer);
  return new ApiError("subscription_required", { details: { reason, upgradeUrl: upgradeUrlFor(reason) } });
}

export type PageGateOptions = MemberGateOptions & {
  /** The path to come back to after sign-in or checkout (same-site path only). */
  returnTo?: string | null;
  /** Pages that must render before onboarding is complete (the onboarding flow itself). */
  skipOnboarding?: boolean;
};

/**
 * Where a page request must go instead of rendering, or null when it may render (CDL §2.4, §6.2 rule 4):
 * signed out → /sign-in; not onboarded → /onboarding; not a member → /pricing?reason=required|ended (B26 default).
 */
export function pageGateRedirect(viewer: (GateViewer & { user: Pick<Viewer["user"], "onboarded"> }) | null, options: PageGateOptions = {}): string | null {
  const returnTo = options.returnTo && options.returnTo.startsWith("/") && !options.returnTo.startsWith("//") ? options.returnTo : null;
  if (!viewer) return returnTo ? `/sign-in?redirect_url=${encodeURIComponent(returnTo)}` : "/sign-in";
  if (!options.skipOnboarding && !viewer.user.onboarded) return "/onboarding";
  if (!passesMemberGate(viewer, options)) return paywallUrlFor(reasonFor(viewer), returnTo);
  return null;
}

/** The signed-in viewer, or ApiError 401 (server actions and services). */
export async function requireViewer(): Promise<Viewer> {
  const { getViewer } = await import("./viewer");
  const viewer = await getViewer();
  if (!viewer) throw new ApiError("unauthorized");
  return viewer;
}

/** The signed-in member, or ApiError 401 / 402 with `details.reason` (server actions and services). */
export async function requireMember(options: MemberGateOptions = {}): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!passesMemberGate(viewer, options)) throw memberDenial(viewer);
  return viewer;
}
