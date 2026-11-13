// /onboarding/welcome (phase-04 plan §4.1). Server: the guard, the greeting name (§8.13), trial eligibility and
// whether an account is already linked; the legend board renders here (StaticBoard, no client JS).
import { auth } from "@clerk/nextjs/server";
import { StaticBoard } from "@/components/board/StaticBoard";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { ledgerAwareViewer } from "@/lib/billing/ledger-viewer";
import { loadStepPage } from "@/lib/data/onboarding";
import { displayName } from "@/lib/onboarding/display-name";
import { welcomeMembership } from "@/lib/onboarding/welcome-view";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WelcomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, state, onb } = await loadStepPage("welcome", await searchParams);
  const [{ sessionClaims }, trialEligible] = await Promise.all([
    auth(),
    // The ledger too (plan 8.4.3; FIX-1): no "7-day free trial" copy for a trial the checkout would refuse. One probe
    // per request, shared with the layout's qk.me() seed (lib/billing/ledger-viewer.ts, FIX-2).
    ledgerAwareViewer(viewer).then((v) => v.entitlement.trial.eligible),
  ]);
  const claimUsername = (sessionClaims as { username?: unknown } | null)?.username;
  const name = displayName({
    clerkUsername: typeof claimUsername === "string" ? claimUsername : null,
    linkedUsernames: state.accounts.map((a) => a.username),
    name: viewer.user.name,
    email: viewer.user.email,
  });
  return (
    <WelcomeStep
      name={name}
      trialEligible={trialEligible}
      linked={onb.hasActiveLink}
      membership={welcomeMembership(viewer.entitlement)}
      board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
    />
  );
}
