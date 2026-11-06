// GET /api/games/[ref] (phase-02 plan §7.1.2): the role-aware snapshot, the same read the RSC page makes
// (lib/games/snapshot.server.ts, one statement after the viewer). Players always; other members only for watchable
// (live) games, with the spectator projection; everyone else 404 (existence is not leaked). The registry entry is
// `auth: "user"` so this handler applies plan 11.1: a non-member gets 402, except a player of an IN_PROGRESS game
// (a lapsed member may finish it).
// Cache: finished games use the registry's `private-etag` tier (ETag "g-<ref>-<updatedAt>-<role>", 304 on match);
// a live game answers `private, no-store` from here (its row lags the socket by up to one checkpoint).
import { gamesEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { respondWith } from "@/lib/api/respond";
import { getRouteDeps } from "@/lib/api/context";
import { memberDenied, route } from "@/lib/api/route";
import { isFinishedStatus } from "@/lib/games/access.server";
import { loadGameSnapshot, rawDb, snapshotEtag } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = route(gamesEndpoints.detail, async (ctx) => {
  const viewer = ctx.viewer!;
  const read = await loadGameSnapshot(rawDb(prisma), ctx.params.ref, viewer.id, ctx.now.getTime());
  if (!viewer.entitlement.member && !(read && read.role.role === "player" && read.row.status === "IN_PROGRESS")) {
    throw memberDenied(getRouteDeps().memberDenialReason(viewer));
  }
  if (!read) throw new ApiError("not_found");
  const data = { snapshot: read.snapshot };
  if (isFinishedStatus(read.row.status)) {
    return respondWith(data, { etag: snapshotEtag(read.snapshot, read.role.role) });
  }
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
});
