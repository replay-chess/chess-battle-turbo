// The legacy `/analysis` retirement (phase-03 plan §7.2 R1, §13.2 H3, P3-D30; owner test T16). Server-only.
//
//   /analysis/<ref>        → 308 /review/<ref>, or /review/<ref>/legend for a game played from a legend position
//                            (`games."chessPositionId"` set); an unknown or malformed ref → 308 /games
//   /api/analysis/<ref>    → 308 /api/review/<ref>
//
// H3 turns it on with the flag `analysis-redirect` (P3 flags; PostHog on dev) while the legacy code is still present,
// so a rollback is one flag flip and no code revert (P3-D30). H4 deletes the legacy page and serves the same targets
// from a route handler (`app/analysis/[gameId]/route.ts` calling `legacyAnalysisRedirect`).
//
// One statement, by `referenceId` (unique index) joined to the viewer's own `game_players` row: a game the viewer did
// not play lands on /games exactly like an unknown ref, so the Location header never tells a stranger that a game
// exists or that it started from a legend position (the 404 masking rule; the old API answered 404 to both). Admins,
// who could open any game's legacy analysis, skip the player check. Signed out = /games (which asks for a sign-in).
// regression: legacy-redirect-reveals-games (FIX-2).
import "server-only";
import { legendComparePath } from "@repo/contracts/http/legend";
import { reviewPath } from "@repo/contracts/http/review";
import { Prisma } from "@repo/db";
import type { GamesDb } from "@/lib/games/snapshot.server";

/** Where every unknown legacy link lands: the archive, where every review starts. */
export const LEGACY_FALLBACK_PATH = "/games";

/** A game reference as the legacy routes received it (cuid-like: letters and digits, ≤ 40). */
const LEGACY_REF = /^[a-z0-9]{1,40}$/i;

/** Who asks: the viewer's users.id and role (lib/auth/viewer.ts `Viewer`), or null when signed out. */
export type LegacyViewer = { id: bigint; role: "user" | "admin" } | null;

/** The lookup: the game, and for a non-admin only when the viewer played it. */
export function legacyTargetSql(ref: string, viewer: NonNullable<LegacyViewer>): Prisma.Sql {
  return viewer.role === "admin"
    ? Prisma.sql`SELECT ("chessPositionId" IS NOT NULL) AS legend FROM games WHERE "referenceId" = ${ref} LIMIT 1`
    : Prisma.sql`SELECT (g."chessPositionId" IS NOT NULL) AS legend
                   FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${viewer.id}
                  WHERE g."referenceId" = ${ref} LIMIT 1`;
}

/** The R1 target of `/analysis/<ref>` (a path; never echoes an unvalidated ref). */
export async function legacyAnalysisTarget(db: GamesDb, ref: string, viewer: LegacyViewer): Promise<string> {
  if (!viewer || !LEGACY_REF.test(ref)) return LEGACY_FALLBACK_PATH;
  const rows = await db.$queryRaw<{ legend: boolean }[]>(legacyTargetSql(ref, viewer));
  const row = rows[0];
  if (!row) return LEGACY_FALLBACK_PATH;
  return row.legend ? legendComparePath(ref) : reviewPath(ref);
}

/** The R1 target of `/api/analysis/<ref>`: the review payload (A1) of the same game. */
export function legacyApiTarget(ref: string): string | null {
  return LEGACY_REF.test(ref) ? `/api/review/${ref}` : null;
}

/** The 308 response of a route handler (`/api/analysis/<ref>` now, `/analysis/<ref>` after H4). */
export function permanentRedirectResponse(target: string, base: string): Response {
  return new Response(null, {
    status: 308,
    headers: { location: new URL(target, base).toString(), "cache-control": "no-store" },
  });
}
