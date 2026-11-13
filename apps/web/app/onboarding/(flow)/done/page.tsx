// /onboarding/done (phase-04 plan §4.8, §5.4 "Done", D4-13, D4-14). Server: the guard (entitled, or a pending
// checkout under 30 min: the "Trial starting…" variant; else the plan), then the first paint: getImportStatus seeds
// `qk.imports()`; the destination is `rc_onb_next` / `?redirect_url=` or /games; the legend CTA appears only when the
// Kasparov–Topalov position exists as a legacy `/position/[ref]`. A viewer whose trial is not confirmed yet gets the
// activation answer (database only) for the passive watcher. The socket token is minted here and <RealtimeBoot>
// renders before the step ("user" hold: import progress, the first review, entitlement:changed).
import { redirect } from "next/navigation";
import { HydrationBoundary } from "@tanstack/react-query";
import type { ActivationData } from "@repo/contracts/http/billing";
import { StaticBoard } from "@/components/board/StaticBoard";
import { DoneStep } from "@/components/onboarding/DoneStep";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { getActivation } from "@/lib/data/billing";
import { getImportStatus } from "@/lib/data/imports";
import { activeProviders, getFeaturedPositionByFen, loadStepPage } from "@/lib/data/onboarding";
import { donePlanFailedHref, legendPositionHref } from "@/lib/onboarding/done-view";
import { providersLabel } from "@/lib/onboarding/plan-view";
import { entitledLike } from "@/lib/onboarding/resolve";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { mintOnboardingSocketToken } from "@/lib/onboarding/socket-token";
import { DEFAULT_DESTINATION } from "@/lib/onboarding/steps";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OnboardingDonePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { viewer, state, onb, now } = await loadStepPage("done", await searchParams);
  const nowDate = new Date(now);
  const entitled = entitledLike(onb);
  const [imports, positionRef, token, watch] = await Promise.all([
    getImportStatus(viewer, { now: nowDate }),
    getFeaturedPositionByFen(LEGEND_POSITION.fen),
    mintOnboardingSocketToken(viewer, now),
    entitled ? Promise.resolve<ActivationData | null>(null) : getActivation(viewer, {}, { dodo: false, now: nowDate }),
  ]);
  // The card was declined while "Trial starting…" waited: nothing to finish here, back to the plan (FIX-1; the client
  // watcher does the same while the page is open).
  if (watch?.state === "failed") redirect(donePlanFailedHref(watch));
  const linked = activeProviders(state);

  const qc = getServerQueryClient();
  qc.setQueryData(qk.imports(), imports.data);

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      <DoneStep
        entitled={entitled}
        trialActive={viewer.entitlement.trial.active}
        daysLeft={viewer.entitlement.trial.daysLeft}
        providers={providersLabel(linked)}
        linked={linked}
        destination={onb.next ?? DEFAULT_DESTINATION}
        legendHref={legendPositionHref(positionRef)}
        board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
        watch={watch}
        summary={{ ratingBand: state.ratingBand, goals: state.goals, dailyMinutes: state.dailyMinutes }}
      />
    </HydrationBoundary>
  );
}
