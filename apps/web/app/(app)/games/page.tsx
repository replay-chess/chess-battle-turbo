// My games (phase-03 plan §4.9, §5.10). First paint comes from the server: the gate (repeated from the layout,
// because layouts do not re-run on soft navigation, CDL §2.4), then page 1 of the URL's filter prefetched through the
// DAL into the same key the client's infinite query uses (archiveListKey). After that the client pages, filters and
// refetches through G1 `GET /api/me/games`, and the socket patches rows.
//
// A failed server read is not dehydrated (successful queries only), so the client simply fetches page 1 itself.
//
// P4 (phase-04 plan §4.11, §5.4): `?source=` is part of the parsed filter (so the seeded key matches the client's),
// and while `import-v3` is on the import status is seeded into `qk.imports()` for the `import_running` banner.
import { HydrationBoundary } from "@tanstack/react-query";
import { GamesArchiveScreen } from "@/features/games/GamesArchiveScreen";
import { archiveListKey } from "@/features/games/data/archive";
import { parseArchiveSearch } from "@/features/games/model/filter";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { listMyGames } from "@/lib/data/games";
import { getImportStatus } from "@/lib/data/imports";
import { getFlags } from "@/lib/flags";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { gamesGate } from "./gate";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function GamesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await gamesGate();
  const { filter } = parseArchiveSearch(await searchParams);
  const qc = getServerQueryClient();
  const importOn = (await getFlags(viewer))["import-v3"];
  await Promise.all([
    qc.prefetchInfiniteQuery({
      queryKey: archiveListKey(filter),
      queryFn: () => listMyGames(viewer, filter, null),
      initialPageParam: null as string | null,
    }),
    importOn
      ? qc.prefetchQuery({
          queryKey: qk.imports(),
          queryFn: async () => (await getImportStatus(viewer, { now: await requestNow() })).data,
        })
      : null,
  ]);
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <GamesArchiveScreen />
    </HydrationBoundary>
  );
}
