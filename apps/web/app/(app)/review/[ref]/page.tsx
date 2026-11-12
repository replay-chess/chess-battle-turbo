// /review/[ref] (phase-03 plan §5.2): a server component. One statement for the payload (getReview, React cache())
// after the cached viewer; the query cache is seeded and dehydrated, so the client renders the board, both strips
// and the panel with no fetch on mount. No side effects: a router prefetch, a link preview or a crawler rendering it
// queues no engine work (P3-D23); an unanalysed game is enqueued by the client's A3 on mount.
// A missing game and a game the viewer did not play are the same 404 (existence is never revealed).
import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { notFound } from "next/navigation";
import { ReviewScreen, type ReviewSource } from "@/features/review/components/ReviewScreen";
import { viewFromSearch } from "@/features/review/view-store";
import { reviewGate } from "@/features/review/gate.server";
import { qk } from "@/lib/api/keys";
import { getReview, isNotFound } from "@/lib/data/review";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Game Review", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SOURCES: readonly ReviewSource[] = ["game_over", "archive", "home", "deeplink", "share_owner"];

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParams> }) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  // The layout already ran the gate; soft navigations skip layouts, so the page repeats it (same cached reads).
  const { viewer, flags } = await reviewGate(ref);

  const qc = getServerQueryClient();
  try {
    await qc.fetchQuery({ queryKey: qk.review.detail(ref), queryFn: () => getReview(viewer, ref) });
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }

  const view = viewFromSearch({ tab: one(sp.tab), ply: one(sp.ply), m: one(sp.m) });
  const from = one(sp.from);
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <ReviewScreen
        refId={ref}
        initialTab={view.tab}
        initialPly={view.ply}
        initialMoment={view.momentIndex}
        flags={{ share: flags["review-share"] }}
        source={SOURCES.includes(from as ReviewSource) ? (from as ReviewSource) : undefined}
      />
    </HydrationBoundary>
  );
}
