// /train/weakness/[pattern], Drill a weakness (phase-06 plan §4.7; DR/V3WeaknessDrill): the profile with the pattern's
// drill config open (inline on the desktop and iPad L, the bottom sheet on phones and iPad P). The layout above has
// validated the slug; the screen reads the selection from the URL, so opening and closing the config later is a
// pushState, never an RSC request.
import { HydrationBoundary } from "@tanstack/react-query";
import { parseTab } from "@/components/train/weakness/copy";
import { WeaknessScreenBoundary } from "@/components/train/weakness/WeaknessScreenBoundary";
import { qk } from "@/lib/api/keys";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { entryOf, loadWeakness, weaknessPatternGate } from "../load";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WeaknessDrillPage({ params, searchParams }: { params: Promise<{ pattern: string }>; searchParams: Promise<SearchParams> }) {
  // The flag, the slug and the READY row again (FIX-1): a request that renders only this segment skips the layouts.
  const viewer = await weaknessPatternGate((await params).pattern);
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
