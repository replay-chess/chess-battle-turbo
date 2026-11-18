// /train/weakness, the Weakness Profile (phase-06 plan §4.1–§4.9, §5.2). Dynamic RSC: the gate (repeated from the
// layouts: soft navigations skip them; cached, so free), then the payload through the DAL into the key the client reads
// (`qk.train.weakness()`), so the first paint makes no /api request. `?tab=` picks the breakdown tab.
//
// No route loading.tsx (deviation from plan §4.9, the code's rule wins): nothing under /train streams a route skeleton
// (app/loading-boundaries.test.ts; train-document.spec.ts: a streamed segment that hydration client-renders leaves the
// server's hidden copy in the document with every test id). The page is in the document's shell; WeaknessSkeleton is
// the design's `loading` state: the demo route, and the client Suspense fallback of WeaknessScreenBoundary.
import { HydrationBoundary } from "@tanstack/react-query";
import { parseTab } from "@/components/train/weakness/copy";
import { WeaknessScreenBoundary } from "@/components/train/weakness/WeaknessScreenBoundary";
import { qk } from "@/lib/api/keys";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { entryOf, loadWeakness, weaknessGate } from "./load";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WeaknessPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // The flag again (FIX-1): a request that renders only this segment skips the layout's check.
  const viewer = await weaknessGate();
  const qc = getServerQueryClient();
  await qc.prefetchQuery({ queryKey: qk.train.weakness(), queryFn: () => loadWeakness(viewer) });
  const p = await searchParams;
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      {/* The client Suspense with the skeleton fallback (WeaknessScreenBoundary): the seeded query never suspends on the
          server, so nothing streams, and the skeleton's markup stays out of the RSC flight. */}
      <WeaknessScreenBoundary initialTab={parseTab(p.tab)} entry={entryOf(p.from)} />
    </HydrationBoundary>
  );
}
