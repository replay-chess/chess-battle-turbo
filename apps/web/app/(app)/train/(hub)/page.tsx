// /train, the Train hub (phase-05 plan §4.2, §5.2 S2). First paint from the server: the gate (repeated from the layout,
// soft navigations skip layouts), then today's plan through the DAL into the key the client reads (`qk.train.today()`),
// so the first paint makes no /api request. `getTrainToday` creates today's plan and profile rows on the first read of
// the local day (the R1 route's registered `daily_plan` side effect). The request time is handed to the client so the
// day words ("tomorrow") render the same on the server and in hydration.
import { HydrationBoundary } from "@tanstack/react-query";
import { TrainHubScreen } from "@/components/train/hub/TrainHubScreen";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import { getTrainToday } from "@/lib/train/today.server";
import { trainGate, trainSocketToken } from "../gate";

export default async function TrainPage() {
  const viewer = await trainGate();
  const now = await requestNow();
  const qc = getServerQueryClient();
  const [token] = await Promise.all([
    trainSocketToken(viewer),
    qc.prefetchQuery({ queryKey: qk.train.today(), queryFn: () => getTrainToday(viewer, now) }),
  ]);
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      <TrainHubScreen serverNowMs={now.getTime()} />
    </HydrationBoundary>
  );
}
