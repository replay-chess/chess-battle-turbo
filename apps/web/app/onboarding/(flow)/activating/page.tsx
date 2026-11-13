// /onboarding/activating (phase-04 plan §4.7, §5.4 "Onboarding activating", §5.6, §8.5). Dodo returns here:
// `?checkout=success&plan=…` (+ Dodo's `subscription_id`, `status`, `email`; the server trusts none of them as proof).
// Server: the guard (a fresh pending checkout, `checkout=success`, or entitlement; else the plan), then the first
// paint from the database only: getActivation(…, {dodo: false}) seeds `qk.billing.activation(key)`, getImportStatus
// seeds `qk.imports()`. The socket token is minted here and <RealtimeBoot> renders before the step, so the step's
// "activation" and "user" holds find the connection on their first effect.
import { HydrationBoundary } from "@tanstack/react-query";
import type { ActivationQuery } from "@repo/contracts/http/billing";
import { StaticBoard } from "@/components/board/StaticBoard";
import { ActivatingStep } from "@/components/onboarding/ActivatingStep";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { activationKeyOf } from "@/lib/api/queries/billing";
import { getActivation } from "@/lib/data/billing";
import { getImportStatus } from "@/lib/data/imports";
import { activeProviders, loadStepPage } from "@/lib/data/onboarding";
import { planParam } from "@/lib/onboarding/plan-view";
import { LEGEND_POSITION } from "@/lib/onboarding/sample-puzzles";
import { mintOnboardingSocketToken } from "@/lib/onboarding/socket-token";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined, max: number): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= max ? s : undefined;
}

export default async function OnboardingActivatingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { viewer, state, now } = await loadStepPage("activating", sp);
  const nowDate = new Date(now);
  const params: ActivationQuery = {
    subscription_id: one(sp.subscription_id, 80),
    session_id: one(sp.session_id, 80),
    status: one(sp.status, 32),
  };
  const [initial, imports, token] = await Promise.all([
    getActivation(viewer, params, { dodo: false, now: nowDate }),
    getImportStatus(viewer, { now: nowDate }),
    mintOnboardingSocketToken(viewer, now),
  ]);
  const isReturn = one(sp.checkout, 16) === "success" || !!params.subscription_id || !!params.session_id || !!params.status;

  const qc = getServerQueryClient();
  qc.setQueryData(qk.billing.activation(activationKeyOf(params)), initial);
  qc.setQueryData(qk.imports(), imports.data);

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      <ActivatingStep
        params={params}
        initial={initial}
        isReturn={isReturn}
        plan={planParam(one(sp.plan, 16))}
        timeZone={state.timeZone}
        linked={activeProviders(state)}
        board={<StaticBoard fen={LEGEND_POSITION.fen} label={LEGEND_POSITION.label} />}
      />
    </HydrationBoundary>
  );
}
