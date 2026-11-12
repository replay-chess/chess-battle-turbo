// The review page gate (phase-03 plan §4.1, §11.1): signed out → sign-in; not onboarded → onboarding; not a member →
// /pricing?reason=…&redirect_url=/review/<ref> (lapsed members read only with `review-lapsed-read`, B26, P3-Q1);
// `review-v3` off → the legacy /analysis page, which still serves reviews until the H3 cut-over. Used by the layout
// (the redirect happens before loading.tsx streams) and by the page (soft navigations skip layouts); both read the
// same React-cached viewer and flags, so the second call costs nothing.
import "server-only";
import { redirect } from "next/navigation";
import { pageGateRedirect } from "@/lib/auth/guards";
import { getViewer, type Viewer } from "@/lib/auth/viewer";
import { getFlags, type FlagValues } from "@/lib/flags";

export async function reviewGate(ref: string, path = ""): Promise<{ viewer: Viewer; flags: FlagValues }> {
  const returnTo = `/review/${encodeURIComponent(ref)}${path}`;
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  const flags = await getFlags(viewer);
  const target = pageGateRedirect(viewer, { returnTo, allowLapsedRead: flags["review-lapsed-read"] });
  if (target) redirect(target);
  if (!flags["review-v3"]) redirect(`/analysis/${encodeURIComponent(ref)}`);
  return { viewer, flags };
}
