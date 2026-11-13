// /settings/connected (phase-04 plan §4.10, §5.4; D4-17): Chess.com and Lichess links, sync, the daily import and
// disconnect. First paint from the server: the gate, then the viewer's accounts through the same DAL as
// `GET /api/accounts` (listLinkedAccounts) into `qk.accounts()`, so the dehydrated query and the API body are
// identical. `?lichess=…&reason=…` (the OAuth return) is handed to the screen, which consumes it once.
import { HydrationBoundary } from "@tanstack/react-query";
import { ConnectedScreen } from "@/components/accounts/ConnectedScreen";
import { qk } from "@/lib/api/keys";
import { requestNow } from "@/lib/api/now";
import { listLinkedAccounts } from "@/lib/data/accounts";
import { logger } from "@/lib/logger";
import { dehydrateFor, getServerQueryClient } from "@/lib/query/server";
import { connectedGate } from "./gate";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function ConnectedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const viewer = await connectedGate();
  const sp = await searchParams;
  const now = await requestNow();
  const qc = getServerQueryClient();
  try {
    qc.setQueryData(qk.accounts(), await listLinkedAccounts(viewer, { now }));
  } catch (err) {
    // Not dehydrated: the client fetches GET /api/accounts itself.
    logger.error(`settings/connected: first-paint accounts read failed (${err instanceof Error ? err.name : "unknown"})`);
  }
  return (
    <HydrationBoundary state={dehydrateFor(qc)}>
      <ConnectedScreen serverNowMs={now.getTime()} lichessParam={{ lichess: one(sp.lichess), reason: one(sp.reason) }} />
    </HydrationBoundary>
  );
}
