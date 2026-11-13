// The onboarding v3 steps (phase-04 plan §4.0): /onboarding/{welcome,link,confirm,level,goals,plan,activating,done}
// in one frame (OnboardingShell), which stays mounted while the steps change. The `onboarding-v3` flag gates the
// whole group: off → every step route is a 404 and /onboarding renders the legacy page (§7.10).
//
// Each step page runs its own guard (loadStepPage → guardStep) before it renders, and on a hard load this layout runs
// the same guard first (guardStepFromLayout, the document's path from middleware's x-rc-pathname), so a guard
// redirect is a plain 307 thrown before anything streams (P2 FIX-A: a redirect after streamed content broke the dev
// router). That makes room for the steps' Suspense boundary inside the frame's <main> (FIX-1): without it, a step
// whose RSC row or client chunk was not there yet when hydration reached it suspended with no boundary below the
// root, and React re-entered <main> with its hydration cursor already on the step (React #418 on ~1–2 % of
// production loads, REGRESSION-4 §4.1). The fallback is empty: the step streams right behind the frame.
import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { PATHNAME_HEADER } from "@/lib/auth/require-member-page";
import { getViewer } from "@/lib/auth/viewer";
import { guardStepFromLayout } from "@/lib/data/onboarding";
import { getFlags } from "@/lib/flags";

export default async function OnboardingFlowLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/sign-in?redirect_url=%2Fonboarding");
  const flags = await getFlags(viewer);
  if (!flags["onboarding-v3"]) notFound();
  const to = await guardStepFromLayout(viewer, (await headers()).get(PATHNAME_HEADER));
  if (to) redirect(to);
  return (
    <OnboardingShell>
      <Suspense fallback={null}>{children}</Suspense>
    </OnboardingShell>
  );
}
