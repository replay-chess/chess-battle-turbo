import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { GalleryFrame } from "../../_components/Specimen";
import { ONBOARDING_DEMOS, type OnboardingDemo } from "../_demos";

export const metadata: Metadata = { title: "Onboarding Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/onboarding/[step]?state=…` (phase-04 plan §4.12): one onboarding step in one design state inside the real
 * frame, on fixtures, with no network and no navigation (the steps' `demo` mode). Fails closed outside dev/test
 * (app/dev/layout.tsx). Params:
 *   state=<state>   the step's states (no state: the index of this step)
 *   stress=1        20-character usernames, 80-character opening names, five-digit counts (the 150 % checks)
 */
export default async function OnboardingStepDemoPage({
  params,
  searchParams,
}: {
  params: Promise<{ step: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { step } = await params;
  const demo = ONBOARDING_DEMOS[step];
  if (!demo) notFound();
  const sp = await searchParams;
  const state = one(sp.state);
  const stress = one(sp.stress) === "1";
  if (!state || !demo.states.includes(state)) return <StepIndex demo={demo} />;
  return (
    <OnboardingShell page={demo.page} demo key={`${state}-${stress}`}>
      {demo.render(state, { stress })}
    </OnboardingShell>
  );
}

function StepIndex({ demo }: { demo: OnboardingDemo }) {
  return (
    <GalleryFrame title={`Onboarding · ${demo.page}`}>
      <p className="mb-4 text-body text-cb-text-soft">
        {demo.board} in each state, on fixtures. Add <code>&amp;stress=1</code> for the long-content variant.
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="onb-demo-index">
        {demo.states.map((s) => (
          <li key={s}>
            <Link className="font-mono text-label underline" href={`/dev/ui/onboarding/${demo.page}?state=${s}`} prefetch={false}>
              {s}
            </Link>
          </li>
        ))}
      </ul>
    </GalleryFrame>
  );
}
