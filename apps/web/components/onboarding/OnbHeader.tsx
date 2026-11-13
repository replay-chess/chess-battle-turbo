"use client";

// The onboarding frame's headers (phase-04 plan §4.0): the desktop bar (logo, stepper, Sign out; V3Onb*) and the
// compact bar (back arrow, "Step N of 4 · Name", Sign out, four segments; V3iPhoneOnb*, V3iPadOnb*). Both are in the
// DOM; CSS shows one (onboarding.css). "Sign out" is P1's signOutEverywhere() with redirectUrl "/".
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { signOutEverywhere, type SignOutClerk } from "@/lib/auth/sign-out";
import { STEPPER, stepLabel, stepperPosition, type OnbPage } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { OnbStepper } from "./OnbStepper";
import { useOnbNav } from "./OnbNav";

/** The Clerk the root layout's ClerkProvider loaded (clerk-js sets `window.Clerk`). */
function loadedClerk(): SignOutClerk | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Clerk?: Partial<SignOutClerk> }).Clerk;
  return c && typeof c.signOut === "function" ? (c as SignOutClerk) : null;
}

function SignOutButton({ page, demo, testId }: { page: OnbPage | null; demo: boolean; testId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy || demo) return;
    setBusy(true);
    if (page) trackOnboarding("onb_signed_out", { step: page });
    // No `@clerk/nextjs` import in the onboarding frame (plan §9.6 budgets, FIX-1): the loaded Clerk instance. Without
    // one (clerk-js failed to load) the sign-in page signs the session out.
    const clerk = loadedClerk();
    if (!clerk) {
      window.location.assign("/sign-in");
      return;
    }
    await signOutEverywhere(clerk, { redirectUrl: "/", queryClient });
  };
  return (
    <button type="button" className="onb-signout" onClick={onClick} disabled={busy} data-testid={testId}>
      Sign out
    </button>
  );
}

export function OnbHeader() {
  const { page, back, demo } = useOnbNav();
  const position = page ? stepperPosition(page) : 0;
  return (
    <>
      <header className="onb-h" data-testid="onb-header">
        {/* No prefetch: the home page is not part of the flow, and every step's load prefetched it (an RSC invocation
            per document load; plan §5.9 budgets one prefetch for the whole onboarding; regression: p04-request-budget). */}
        <Link href="/" prefetch={false} className="onb-logo" aria-label="ReplayChess home">
          <Image src="/chess-logo-bnw.png" alt="" width={32} height={32} priority />
          <span className="onb-logo__word" aria-hidden="true">
            ReplayChess
          </span>
        </Link>
        <OnbStepper page={page} />
        <SignOutButton page={page} demo={demo} testId="onb-sign-out" />
      </header>
      <div className="onb-mh" data-testid="onb-mobile-header">
        {/* No prefetch on Back (regression: level-back-stale-band, see OnbStepper). */}
        {back ? (
          <Link href={back} prefetch={false} className="onb-mh__back" aria-label="Back" data-testid="onb-back">
            <ChevronLeft aria-hidden="true" />
          </Link>
        ) : (
          <span className="onb-mh__gap" aria-hidden="true" />
        )}
        <Image className="onb-mh__logo" src="/chess-logo-bnw.png" alt="" width={30} height={30} />
        <span className="onb-lbl onb-mh__label" data-testid="onb-step-label">
          {page ? stepLabel(page) : "Welcome"}
        </span>
        <SignOutButton page={page} demo={demo} testId="onb-sign-out-compact" />
      </div>
      <div className="onb-segs" aria-hidden="true">
        {STEPPER.map((s) => (
          <span key={s.n} data-on={s.n <= position ? "" : undefined} />
        ))}
      </div>
    </>
  );
}
