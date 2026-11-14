// /train/bank, the Mistake Bank (phase-05 plan §4.3, §5.2 S3). First paint from the server: the gate, then page 1 of
// the WHOLE bank through the DAL into `qk.train.bank({})` (BankScreen's base query). A bank of ≤ 300 cards arrives
// complete and every tab and filter runs on the client; a larger one also gets the URL's filter seeded into its own
// key, so the first paint makes no /api request either way. URL state is parsed here so the server render and the
// hydration agree on the tab, the filters and the selection.
import { HydrationBoundary } from "@tanstack/react-query";
import { BankScreen } from "@/components/train/bank/BankScreen";
import { BASE_BANK_FILTER, parseBankSearch, serverFilterOf } from "@/components/train/bank/model";
import { serverBuildId } from "@/lib/api/context";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import type { BankListData } from "@/lib/api/queries/train";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { RealtimeBoot } from "@/lib/realtime/RealtimeBoot";
import { listBank } from "@/lib/train/bank.server";
import { trainGate, trainSocketToken } from "../../gate";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BankPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await trainGate();
  const initial = parseBankSearch(await searchParams);
  const now = await requestNow();
  const qc = getServerQueryClient();
  const [token] = await Promise.all([
    trainSocketToken(viewer),
    qc.prefetchInfiniteQuery({
      queryKey: qk.train.bank(BASE_BANK_FILTER),
      queryFn: () => listBank(viewer, { view: "all" }, null, now),
      initialPageParam: null as string | null,
    }),
  ]);
  // A failed read is not dehydrated (successful queries only): the client then fetches page 1 itself.
  const base = qc.getQueryData<BankListData>(qk.train.bank(BASE_BANK_FILTER));
  const filter = serverFilterOf(initial);
  const filtered = Object.values(filter).some((v) => v !== undefined);
  if (base && base.pages[0]?.meta.complete !== true && filtered) {
    await qc.prefetchInfiniteQuery({
      queryKey: qk.train.bank(filter),
      queryFn: () => listBank(viewer, { ...filter, view: filter.view ?? "all" }, null, now),
      initialPageParam: null as string | null,
    });
  }
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <RealtimeBoot token={token} buildId={serverBuildId()} />
      <BankScreen initial={initial} serverNowMs={now.getTime()} />
    </HydrationBoundary>
  );
}
