import type { Metadata } from "next";
import Link from "next/link";
import { GalleryFrame } from "../_components/Specimen";
import { ONBOARDING_DEMOS } from "./_demos";

export const metadata: Metadata = { title: "Onboarding Demo", robots: { index: false, follow: false } };

/** `/dev/ui/onboarding` (phase-04 plan §4.12): every onboarding step and state on fixtures. */
export default function OnboardingDemoIndex() {
  return (
    <GalleryFrame title="Onboarding Demo">
      <p className="mb-4 text-body text-cb-text-soft">Onboarding v3 (phase-04 plan §4) in each design state, on fixtures, without the network.</p>
      <div className="flex flex-col gap-6" data-testid="onb-demo-steps">
        {Object.values(ONBOARDING_DEMOS).map((d) => (
          <section key={d.page}>
            <h2 className="mb-2 font-mono text-label uppercase">
              {d.page} · {d.board}
            </h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1">
              {d.states.map((s) => (
                <li key={s}>
                  <Link className="font-mono text-label underline" href={`/dev/ui/onboarding/${d.page}?state=${s}`} prefetch={false}>
                    {s}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </GalleryFrame>
  );
}
