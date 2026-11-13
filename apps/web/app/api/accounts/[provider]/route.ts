// ACC-5 `PATCH /api/accounts/{provider}` and ACC-6 `DELETE /api/accounts/{provider}?deleteGames=0|1` (phase-04 plan
// §7.3.7, §7.3.8, §8.10, §8.12; D4-21, D4-27). `/api/accounts/chesscom` reaches these through ../chesscom/route.ts.
//
// PATCH: the daily auto-import switch. A body `timeZone` (sent when the browser's zone differs from the stored one)
// is written first in the same transaction, because the daily slot is "about 3 a.m. your time" (§8.10). On: the
// DAILY job at `nextAutoSyncAt` unless a job is already queued or running. Off: the queued DAILY job is deleted.
// Answers the account's `LinkedAccountView`.
//
// DELETE: removes the link (cascades cursor and runs; already-imported game_players keep their rows with
// linkedAccountId NULL), the queued import job, and for Chess.com the legacy chess_com_profiles row. `deleteGames=1`
// queues IMPORT_PURGE for that provider's imported games (the worker removes them and their reviews). Nothing is
// called on Lichess: no token was ever stored (D4-21). After the response: kick (when purging), audit
// `account.unlinked`, event `account_unlinked`.
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { route } from "@/lib/api/route";
import { runLinkEffects } from "@/lib/accounts/effects";
import { requireImportFlag } from "@/lib/accounts/flag";
import { setAutoImport, unlinkAccount } from "@/lib/accounts/link-service";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const PATCH = route(accountsEndpoints.update, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  return setAutoImport({ viewer, provider: ctx.params.provider, autoImport: ctx.body.autoImport, timeZone: ctx.body.timeZone, now: ctx.now });
});

export const DELETE = route(accountsEndpoints.unlink, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const out = await unlinkAccount({ viewer, provider: ctx.params.provider, deleteGames: ctx.query.deleteGames === "1", now: ctx.now });
  ctx.after(() => runLinkEffects(out.effects, { viewer, requestId: ctx.requestId, now: ctx.now }));
  return { removed: true as const, purge: out.purge };
});
