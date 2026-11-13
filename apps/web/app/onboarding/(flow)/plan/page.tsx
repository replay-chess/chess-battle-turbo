// /onboarding/plan (phase-04 plan §4.6, §5.4 "Plan"). Server: the guard (members, admins and paywall-off viewers
// never see it: → done), trial eligibility, `?plan` (default monthly), the banners of `?status=failed` and
// `?resume=abandoned`, and the charge date "today + 7 days" in the viewer's zone (`users."timeZone"`). After a
// failed card the server's activation answer (database only, no Dodo call) seeds the passive watcher.
import { PlanStep } from "@/components/onboarding/PlanStep";
import type { ActivationData } from "@repo/contracts/http/billing";
import { shortDateLabel, trialChargeDateFrom } from "@/lib/billing/activation-copy";
import { ledgerAwareViewer } from "@/lib/billing/ledger-viewer";
import { getActivation } from "@/lib/data/billing";
import { activeProviders, loadStepPage } from "@/lib/data/onboarding";
import { logger } from "@/lib/logger";
import { planBanner, planParam, providersLabel } from "@/lib/onboarding/plan-view";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { viewer, state, now } = await loadStepPage("plan", sp);
  const nowDate = new Date(now);
  // The ledger too (plan 8.4.3; FIX-1): a re-signup or an email variant of a used trial is offered no trial here,
  // exactly as the checkout decides.
  // One probe per request, shared with the layout's qk.me() seed (lib/billing/ledger-viewer.ts, FIX-2).
  const trialEligible = (await ledgerAwareViewer(viewer)).entitlement.trial.eligible;
  const status = one(sp.status) ?? null;

  let watch: ActivationData | null = null;
  if (status === "failed") {
    try {
      watch = await getActivation(viewer, {}, { dodo: false, now: nowDate });
    } catch (err) {
      // The banner still says what happened; only the late-success watcher is lost.
      logger.warn(`onboarding plan: activation read failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return (
    <PlanStep
      trialEligible={trialEligible}
      initialPlan={planParam(one(sp.plan))}
      banner={planBanner({ status, resume: one(sp.resume) ?? null })}
      chargeDateLabel={trialEligible ? shortDateLabel(trialChargeDateFrom(nowDate), state.timeZone) : null}
      providers={providersLabel(activeProviders(state))}
      timeZone={state.timeZone}
      nowIso={nowDate.toISOString()}
      watch={watch}
    />
  );
}
