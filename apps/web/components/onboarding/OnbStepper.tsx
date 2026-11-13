// The desktop stepper (phase-04 plan §4.0; `ol.stp` on V3Onb*): four numbered items; the current one has
// aria-current="step"; a done one shows a check and links back to its step. No hooks, so it renders on either side.
import Link from "next/link";
import { Check } from "lucide-react";
import { STEPPER, stepPath, stepperState, stepperTarget, type OnbPage } from "@/lib/onboarding/steps";

export function OnbStepper({ page }: { page: OnbPage | null }) {
  return (
    <ol className="onb-stp" aria-label="Setup progress" data-testid="onb-stepper">
      {STEPPER.map((s) => {
        const state = page ? stepperState(page, s.n) : "todo";
        const inner = (
          <>
            <span className="n">{state === "done" ? <Check aria-hidden="true" width={12} height={12} strokeWidth={2} /> : s.n}</span>
            <span className="w">{s.label}</span>
          </>
        );
        return (
          <li key={s.n} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            {/* No prefetch: an earlier step's page depends on what the member saved since (the chosen band); a prefetched
                payload could be replayed on Back or Alt+← (regression: level-back-stale-band). */}
            {state === "done" && page !== "done" ? (
              <Link href={stepPath(stepperTarget(s.n))} prefetch={false} aria-label={`${s.label}, done. Go back to this step.`}>
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}
