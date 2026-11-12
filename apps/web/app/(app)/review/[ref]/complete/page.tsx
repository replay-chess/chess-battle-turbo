// /review/[ref]/complete (phase-03 plan §4.2, §5.3): a server component. One DAL call (getReviewComplete: the review
// payload's tables and the month's best accuracy, in parallel); no client query, plain links. The layout above
// already gated sign-in, membership and `review-v3`; soft navigations skip layouts, so the page repeats the gate (the
// same React-cached reads). A7 is not called here: Finish Review sent it, and a direct visit renders `partial` while
// `completedAt` is unset. Not a player → the same 404 as the review; analysis not done → back to the review.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CompleteView, type CompleteLinks } from "@/features/review/complete/CompleteView";
import { reviewGate } from "@/features/review/gate.server";
import { reviewPath, reviewSharePath } from "@/features/review/paths";
import { ApiError } from "@/lib/api/api-error";
import { getReviewComplete, isNotFound } from "@/lib/data/review";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review Complete", robots: { index: false, follow: false } };

export default async function ReviewCompletePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const { viewer, flags } = await reviewGate(ref, "/complete");
  let view;
  try {
    view = await getReviewComplete(viewer, ref, flags["review-share"]);
  } catch (err) {
    if (isNotFound(err)) notFound();
    if (err instanceof ApiError && err.code === "conflict") redirect(reviewPath(ref));
    throw err;
  }
  const links: CompleteLinks = {
    playAgain: "/play",
    share: flags["review-share"] ? `${reviewSharePath(ref)}?from=complete` : null,
    reviewAgain: reviewPath(ref, { moment: 1 }),
    games: "/games",
    review: reviewPath(ref),
    moment: (n) => reviewPath(ref, { moment: n }),
  };
  return <CompleteView view={view} links={links} />;
}
