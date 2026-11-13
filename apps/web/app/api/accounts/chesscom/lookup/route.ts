// ACC-2 `POST /api/accounts/chesscom/lookup` (phase-04 plan §7.3.1; D4-08, D4-10, D4-23, D4-26). Looks a Chess.com
// handle up (profile then stats, serially; cached 600 s server-side incl. `not_found`; the worker answers when Chess.com
// limits Vercel's IPs) and answers `LookupData`: `found`, `no_games` or `private` (closed), 404 for an unknown handle,
// 409 `linked_elsewhere` when another member holds a verified link. Limits: 10 / 60 s per user and 30 / 60 s per IP
// (`details.source: "replay"`); Chess.com's own limit through the worker is 429 `source: "chesscom"`; a dead upstream
// is 502 `upstream_unavailable {provider: "chesscom", kind}`. The response is `no-store`; the avatar URL travels but the
// UI renders initials (D4-26). Span tags `cache: hit | miss`, `source: web | worker`; `Server-Timing: cache;desc=hit|miss`
// in every environment.
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { respondWith } from "@/lib/api/respond";
import { route } from "@/lib/api/route";
import { getRouteDeps } from "@/lib/api/context";
import { chesscomLookup } from "@/lib/accounts/chesscom";
import { requireImportFlag } from "@/lib/accounts/flag";
import { lookupDataOf, privateLookupData } from "@/lib/accounts/preview";
import { captureAccountsServerEvent } from "@/lib/accounts/telemetry";
import { verifiedElsewhere } from "@/lib/data/accounts";
import { DataError } from "@/lib/data/errors";
import { rawDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const POST = route(accountsEndpoints.lookup, async (ctx) => {
  const viewer = ctx.viewer!;
  await requireImportFlag(viewer);
  const { value, cache } = await chesscomLookup(ctx.body.username);
  ctx.timing.mark("lookup");
  const telemetry = getRouteDeps().telemetry;
  telemetry.setTag("cache", cache);
  telemetry.setTag("source", value.source);
  if (cache === "miss" && value.fallbackStatus) {
    const props = { upstream_status: value.fallbackStatus, result: value.kind };
    ctx.after(() => captureAccountsServerEvent("account_lookup_fallback_used", props, viewer.ref));
  }
  if (value.kind === "not_found") throw new DataError("not_found");
  // `cache;desc=hit|miss` in every environment: the Link step's `onb_link_lookup_result.is_cache_hit` reads it.
  const headers = { "Server-Timing": `cache;desc=${cache}` };
  if (value.kind === "private") return respondWith(privateLookupData(ctx.body.username, value.profile), { headers });
  if (await verifiedElsewhere(rawDb(prisma), "CHESSCOM", String(value.profile.player_id), viewer.id)) {
    throw new DataError("conflict", { details: { reason: "linked_elsewhere" } });
  }
  return respondWith(lookupDataOf(value.profile, value.stats), { headers });
});
