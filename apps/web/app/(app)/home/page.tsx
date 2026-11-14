// Home (phase-05 plan §4.1, §5.2 S1). First paint from the server: the gate (repeated from the layout, because layouts
// do not re-run on soft navigation), then one awaited prefetch of qk.home() through the DAL (getHomeData: one parallel
// batch), dehydrated into the key HomeScreen's useQuery reads. No /api request at first paint; after that the client
// refetches on focus when stale and the user room patches the counts.
import { HydrationBoundary } from "@tanstack/react-query";
import { HomeScreen } from "@/components/home/HomeScreen";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { getHomeData } from "@/lib/home/home.server";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { homeGate } from "./gate";

export default async function HomePage() {
  const viewer = await homeGate();
  const now = await requestNow();
  const qc = getServerQueryClient();
  await qc.prefetchQuery({ queryKey: qk.home(), queryFn: () => getHomeData(viewer, now) });
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <HomeScreen profileHref={`/profile/${encodeURIComponent(viewer.ref)}`} />
    </HydrationBoundary>
  );
}
