// /checkout/activating (phase-04 plan 4.9, 5.4, 8.5): where every non-onboarding checkout returns
// (`?redirect_url=…&checkout=success&source=…&plan=…`, Dodo adds `subscription_id`, `status`, `email`). First paint is
// RSC: getActivation(viewer, params, {dodo: false}) (the database only; it never sets cookies, D4-29) seeds
// `qk.billing.activation(key)`, and the viewer seeds `qk.me()`. The client then polls BIL-2 and listens for
// `entitlement:changed`. The destination is the checked `redirect_url` (or /games), or /onboarding for a viewer who
// has not finished setup; never this page itself.
import { HydrationBoundary } from "@tanstack/react-query";
import { redirect } from "next/navigation";
import type { ActivationQuery } from "@repo/contracts/http/billing";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { activationKeyOf } from "@/lib/api/queries/billing";
import { getViewer } from "@/lib/auth/viewer";
import { meDataOf } from "@/lib/auth/viewer-dto";
import { ledgerAwareViewer } from "@/lib/billing/ledger-viewer";
import { destinationLabel } from "@/lib/billing/activation-copy";
import { activationDestination } from "@/lib/billing/return-url";
import { getActivation } from "@/lib/data/billing";
import { getFlags } from "@/lib/flags";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { ActivatingView } from "./ActivatingView";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined, max: number): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= max ? s : undefined;
}

export default async function CheckoutActivatingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent("/checkout/activating")}`);

  const params: ActivationQuery = {
    subscription_id: one(sp.subscription_id, 80),
    session_id: one(sp.session_id, 80),
    status: one(sp.status, 32),
  };
  const now = await requestNow();
  const [initial, flags] = await Promise.all([getActivation(viewer, params, { dodo: false, now }), getFlags(viewer)]);
  const isReturn = one(sp.checkout, 16) === "success" || !!params.subscription_id || !!params.session_id || !!params.status;
  const destination = activationDestination(one(sp.redirect_url, 512), viewer.user.onboarded);
  const planParam = one(sp.plan, 16);

  const qc = getServerQueryClient();
  qc.setQueryData(qk.billing.activation(activationKeyOf(params)), initial);
  qc.setQueryData(qk.me(), meDataOf(await ledgerAwareViewer(viewer), flags, serverBuildId())); // FIX-2: ledger-aware

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <ActivatingView
        params={params}
        initial={initial}
        isReturn={isReturn}
        source={one(sp.source, 16) ?? null}
        plan={planParam === "monthly" || planParam === "yearly" ? planParam : null}
        destination={destination}
        destinationLabel={destinationLabel(destination)}
        timeZone={viewer.user.timeZone ?? "UTC"}
      />
    </HydrationBoundary>
  );
}
