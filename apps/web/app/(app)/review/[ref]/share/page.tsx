// /review/[ref]/share (phase-03 plan §4.3, §5.4; flag `review-share`): a server component that seeds the review
// payload (the preview card and Copy PGN read it) and the viewer's live link (`getActiveShare`, null when none), and
// renders the client ShareScreen. No creation on GET (prefetch safety): the screen sends A10 once on mount when there
// is no live link. The flag off, a non-player and a missing game are the same 404; a
// review that is not done yet sends the viewer back to the review (Share Analysis is disabled until DONE there).
import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";
import { reviewGate } from "@/features/review/gate.server";
import { reviewPath } from "@/features/review/paths";
import { ShareScreen } from "@/features/share/ShareScreen";
import { qk } from "@/lib/api/keys";
import { getReview, isNotFound } from "@/lib/data/review";
import { getActiveShare } from "@/lib/data/share";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Share Analysis", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReviewSharePage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParams> }) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const { viewer, flags } = await reviewGate(ref, "/share");
  if (!flags["review-share"]) notFound();

  const qc = getServerQueryClient();
  let status: string;
  try {
    const [review, share] = await Promise.all([getReview(viewer, ref), getActiveShare(viewer, ref)]);
    qc.setQueryData(qk.review.detail(ref), review);
    qc.setQueryData(qk.review.share(ref), share);
    status = review.status;
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }
  if (status !== "done") redirect(reviewPath(ref));

  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <ShareScreen refId={ref} from={one(sp.from) === "complete" ? "complete" : "review_menu"} />
    </HydrationBoundary>
  );
}
