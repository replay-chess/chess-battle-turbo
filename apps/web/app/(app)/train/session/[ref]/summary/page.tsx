// /train/session/[ref]/summary (S7, phase-05 plan §4.7, §5.2 S7): `getSessionSummary` (404 for a foreign ref) seeds
// `qk.train.summary(ref)`; `?n=` is how many attempts the device graded, so the screen shows "Saving your results…"
// while the server holds fewer. A session with no attempt (abandoned, empty) goes back to /train.
import type { Metadata } from "next";
import { HydrationBoundary } from "@tanstack/react-query";
import { notFound, redirect } from "next/navigation";
import { SummaryScreen } from "@/components/train/summary/SummaryScreen";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { requireMemberPage } from "@/lib/auth/require-member-page";
import { isNotFound } from "@/lib/data/errors";
import { getFlags } from "@/lib/flags";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { getSessionSummary } from "@/lib/train/sessions.server";
import { clientGradedOf } from "@/features/train/session-spec";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Session Summary", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TrainSummaryPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<SearchParams> }) {
  const [{ ref }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireMemberPage({ returnTo: `/train/session/${encodeURIComponent(ref)}/summary` });
  if (!(await getFlags(viewer)).train) notFound(); // the flag registry: off → /train/** pages 404
  const qc = getServerQueryClient();
  let summary;
  try {
    summary = await qc.fetchQuery({ queryKey: qk.train.summary(ref), queryFn: async () => getSessionSummary(viewer, ref, await requestNow()) });
  } catch (err) {
    if (isNotFound(err)) notFound();
    throw err;
  }
  const clientGraded = clientGradedOf(sp.n);
  if (summary.graded === 0 && summary.stats.skipped === 0 && !clientGraded) redirect("/train");
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <SummaryScreen summary={summary} clientGraded={clientGraded} />
    </HydrationBoundary>
  );
}
