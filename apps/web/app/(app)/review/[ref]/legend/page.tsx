// /review/[ref]/legend — Compare with the legend (phase-03 plan §4.6, §5.7). A server component: the gate (sign-in,
// membership, `review-v3`; the review layout already ran it, soft navigations skip layouts so the page repeats it from
// the same cached reads), then one A9 read through the DAL (`getLegendCompare`: it may insert the derived facts row,
// `legend_facts`, but never enqueues engine work, so a router prefetch of this page queues nothing, P3-D23) into
// `qk.review.legend(ref)`, dehydrated: the client renders the board and the aside with no fetch on mount and sends the
// page's one A9b itself when the evals are missing.
//
// A game with no legend position (and, indistinguishably, a game the viewer did not play) → a permanent redirect to
// `/review/<ref>`, which answers 404 for a non-player (existence is never revealed).
import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { permanentRedirect } from "next/navigation";
import { CompareScreen } from "@/features/legend-compare/CompareScreen";
import { reviewGate } from "@/features/review/gate.server";
import { reviewPath } from "@/features/review/paths";
import { qk } from "@/lib/api/keys";
import { isNotFound } from "@/lib/data/errors";
import { getLegendCompare } from "@/lib/data/legend";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare with the Legend", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function LegendComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const { viewer, flags } = await reviewGate(ref, "/legend");

  const qc = getServerQueryClient();
  let missing = false;
  try {
    await qc.fetchQuery({ queryKey: qk.review.legend(ref), queryFn: () => getLegendCompare(viewer, ref) });
  } catch (err) {
    if (!isNotFound(err)) throw err;
    missing = true;
  }
  if (missing) permanentRedirect(reviewPath(ref));

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <CompareScreen
        refId={ref}
        initial={{ tab: one(sp.tab), ply: one(sp.ply) }}
        from={one(sp.from)}
        flags={{ share: flags["review-share"] }}
      />
    </HydrationBoundary>
  );
}
