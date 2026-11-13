// /dev/ui/activating (phase-04 plan 4.12): the activation card in every designed state, on fixtures, with no network
// (no socket, no poll). Fails closed outside dev/test (app/dev/layout.tsx; prod-guard.spec.ts proves the 404).
//   kind=checkout|onboarding   checkout: DR/V3CheckoutActivating (top bar, card + "Your trial" aside);
//                              onboarding: the shared ActivationCard as DR/V3OnbActivating's panel uses it
//   state=polling|success|stalled|failed
//   trial=0                    a paid (non-trial) checkout: "Activating your membership…" / "Your membership is active."
//   already=1                  success for a member who arrived without a checkout return (no countdown)
//   stress=1                   a 20-character destination, the longest reference, a long wait (one-viewport checks at 150 %)
import type { Metadata } from "next";
import Link from "next/link";
import { ActivationCard, type ActivationCardPhase } from "@/components/billing/ActivationCard";
import { PlanSummaryAside } from "@/components/billing/PlanSummaryAside";
import { ActivatingTopNav } from "@/app/checkout/activating/TopNav";
import { GalleryFrame } from "../_components/Specimen";

export const metadata: Metadata = { title: "Activating Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const STATES = ["polling", "success", "stalled", "failed"] as const satisfies readonly ActivationCardPhase[];
const KINDS = ["checkout", "onboarding"] as const;

function isState(v: string | undefined): v is ActivationCardPhase {
  return (STATES as readonly string[]).includes(v ?? "");
}

export default async function ActivatingDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const state = one(p.state);
  const kind = one(p.kind) === "onboarding" ? "onboarding" : "checkout";
  if (!isState(state)) return <StateIndex />;
  const stress = one(p.stress) === "1";
  const isTrial = one(p.trial) !== "0";
  const already = one(p.already) === "1" && state === "success";
  const destination = stress ? "Tournament Qualifiers" : "Play";
  const card = (
    <ActivationCard
      kind={kind}
      phase={state}
      isTrial={isTrial}
      alreadyMember={already}
      chargeDateLabel="6 Nov"
      trialEndsLabel="5 Nov"
      priceLabel="$4.99"
      destinationLabel={destination}
      countdownSeconds={kind === "checkout" && !already ? 3 : null}
      reference={stress ? "sub_8F2KXQ9P…Q1" : "sub_8F2K…Q1"}
      waitedLabel={stress ? "12 h 45 min" : "2 min"}
      supportHref="/contact?topic=billing&ref=sub_8F2K%E2%80%A6Q1"
      continueHref={kind === "checkout" ? "/play" : "/onboarding/done"}
      membershipHref="/pricing"
      tryAgainHref="/pricing?checkout=failed&plan=monthly"
      homeHref="/"
    />
  );

  if (kind === "onboarding") {
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-cb-bg text-cb-text" data-testid="activating-demo" data-kind="onboarding" data-state={state}>
        <main className="flex min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[600px]:px-4">
          <div className="m-auto w-[min(560px,100%)]">{card}</div>
        </main>
      </div>
    );
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-cb-bg text-cb-text" data-testid="activating-demo" data-kind="checkout" data-state={state}>
      <ActivatingTopNav name={stress ? "Maximilian Featherstonehaugh" : "Knight Owl"} profileHref="/dev/ui/activating" />
      <main className="flex min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[600px]:px-4 max-[600px]:py-4 [@media(max-height:640px)]:py-3">
        <div className="m-auto grid w-[min(1000px,100%)] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-stretch gap-6 max-[900px]:grid-cols-1 max-[600px]:gap-3">
          {card}
          <PlanSummaryAside
            isTrial={isTrial}
            interval="month"
            chargeDateLabel="6 Nov"
            destinationLabel={destination}
            showReturn={state === "polling" || state === "stalled"}
          />
        </div>
      </main>
    </div>
  );
}

function StateIndex() {
  return (
    <GalleryFrame title="Activating Demo">
      <p className="mb-4 text-body text-cb-text-soft">The activation card (phase-04 plan 4.7, 4.9) in each design state, on fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="activating-demo-index">
        {KINDS.flatMap((k) =>
          STATES.map((s) => (
            <li key={`${k}-${s}`}>
              <Link className="font-mono text-label underline" href={`/dev/ui/activating?kind=${k}&state=${s}`} prefetch={false}>
                {k} · {s}
              </Link>
            </li>
          )),
        )}
      </ul>
    </GalleryFrame>
  );
}
