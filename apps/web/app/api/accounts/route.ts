// ACC-1 `GET /api/accounts` (phase-04 plan §7.0, §5.3): the viewer's linked Chess.com and Lichess accounts, each with
// its newest run and the §8.11 view status. ONE statement (lib/data/accounts.ts). `private-etag`: a quiet poll from
// /settings/connected (only while an account syncs and the socket is down, §5.7) is a 304. `import-v3` off → 404.
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { requireImportFlag } from "@/lib/accounts/flag";
import { listLinkedAccounts } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route(accountsEndpoints.list, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  return listLinkedAccounts(viewer, { now: ctx.now });
});
