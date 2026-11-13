// My games (phase-03 plan §5.10, §7.2 G1, §7.3 listMyGames, §9.3; P3-D25, P3-D27). The `/games` RSC (through
// WEB/lib/data/games.ts) and `GET /api/me/games` call the same function, so the first paint and a client refetch of
// page 1 agree.
//
// - Keyset pages over `game_players."endedAt"`: the cursor is P1's opaque base64url `[1, endedAt ISO, gameId]`
//   (`@repo/contracts/http/cursor`); a tampered or foreign cursor is a 400 on `cursor`, never a scan from the start.
// - Page 1 (no cursor) and `limit=0` carry `filteredTotal` and `counts.all`; later pages carry only `nextCursor` (AP-38).
// - The strong ETag is `g<users.gamesVersion>-<hash(filter, cursor, limit, year)>`: every write that changes a row
//   (a finish, A3/A4, the worker's done and fail batches) bumps gamesVersion, so a revalidation needs no statement
//   beyond the viewer (P3-D27). The UTC year is in the hash because the date labels drop the year for this year.
// - P4 (phase-04 plan §4.11): `?source=` picks one source tab; the counts carry `replay`/`chesscom`/`lichess` once
//   the viewer has imported games (a Replay-only archive answers `{ all }`, so the tabs stay hidden for it).
import { decodeCursor, encodeCursor } from "@repo/contracts/http/cursor";
import {
  gamesFilterOf,
  gamesFilterToSearch,
  type GameRowDTO,
  type GamesFilter,
  type GamesPageMeta,
  type GamesQuery,
} from "@repo/contracts/http/games";
import { GAME_SOURCES_WIRE, MAX_MOMENTS, type GameSourceWire } from "@repo/contracts/http/review";
import { ApiError } from "@/lib/api/api-error";
import { fnv1a64 } from "@/lib/api/etag";
import type { Viewer } from "@/lib/auth/viewer";
import type { GamesDb } from "@/lib/games/snapshot.server";
import {
  archiveCountsSql,
  archivePageSql,
  type ArchiveCountsRow,
  type ArchiveCursor,
  type ArchiveFilter,
  type ArchiveRow,
} from "./archive-sql";
import { opponentKindOf, playedAtLabelOf, tcOf } from "./review-dto";

export type { ArchiveFilter };
export type ArchiveRequest = { filter: ArchiveFilter; cursor: ArchiveCursor | null; limit: number };

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BIGINT_ID = /^[1-9]\d{0,18}$/;
const INT8_MAX = 9_223_372_036_854_775_807n;

/** Decodes a G1 cursor; null for none. A malformed one throws the 400 the route answers (path `cursor`). */
export function decodeArchiveCursor(raw: string | undefined | null): ArchiveCursor | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const parts = decodeCursor<[string, string]>(raw, 2);
  const bad = () => new ApiError("validation_failed", { fields: { cursor: "Invalid cursor" } });
  if (!parts) throw bad();
  const [endedAt, gameId] = parts;
  if (typeof endedAt !== "string" || !ISO_MS.test(endedAt) || Number.isNaN(Date.parse(endedAt))) throw bad();
  if (typeof gameId !== "string" || !BIGINT_ID.test(gameId) || BigInt(gameId) > INT8_MAX) throw bad();
  return { endedAt, gameId };
}

export function encodeArchiveCursor(row: Pick<ArchiveRow, "endedAt" | "gameId">): string {
  return encodeCursor([new Date(row.endedAt).toISOString(), row.gameId.toString()]);
}

/** The parsed G1 query (the RSC builds the same from its searchParams with `gamesFilterOf`). */
export function archiveRequestOf(query: GamesQuery): ArchiveRequest {
  return {
    filter: withSource(gamesFilterOf({ q: query.q, result: query.result, tc: query.tc, moments: query.moments }), query.source),
    cursor: decodeArchiveCursor(query.cursor),
    limit: query.limit,
  };
}

type SearchParams = Record<string, string | string[] | undefined>;

const firstOf = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** zod 4 `stringbool()`'s truthy strings (GamesQuery.moments), so the page and G1 agree on `?moments=`. */
const TRUTHY = new Set(["1", "true", "yes", "on", "y", "enabled"]);

/** The filter plus a known source tab (an unknown or absent one is All). */
function withSource(filter: GamesFilter, source: string | undefined): ArchiveFilter {
  return source && (GAME_SOURCES_WIRE as readonly string[]).includes(source) ? { ...filter, source: source as GameSourceWire } : filter;
}

/** The filter of a `/games?…` URL for the RSC (unknown values dropped, a 1-character search ignored): G1's parsing. */
export function parseGamesFilter(sp: SearchParams): ArchiveFilter {
  const moments = (firstOf(sp.moments) ?? "").trim().toLowerCase();
  const filter = gamesFilterOf({ q: firstOf(sp.q), result: firstOf(sp.result), tc: firstOf(sp.tc), moments: TRUTHY.has(moments) });
  return withSource(filter, firstOf(sp.source));
}

/** `g<gamesVersion>-<fnv1a64>` (quoted by route()). The source tab joins the hash only when one is picked. */
export function archiveEtag(gamesVersion: number, req: ArchiveRequest, nowMs: number): string {
  const cursor = req.cursor ? `${req.cursor.endedAt}|${req.cursor.gameId}` : "";
  const year = new Date(nowMs).getUTCFullYear();
  const source = req.filter.source ? `#source=${req.filter.source}` : "";
  return `g${gamesVersion}-${fnv1a64(`${gamesFilterToSearch(req.filter)}#${cursor}#${req.limit}#${year}${source}`)}`;
}

const STATUS_WIRE: Record<ArchiveRow["analysisStatus"], GameRowDTO["analysisStatus"]> = {
  NONE: "none",
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  SKIPPED: "skipped",
};
const RESULT_WIRE: Record<ArchiveRow["result"], GameRowDTO["result"]> = { WIN: "win", LOSS: "loss", DRAW: "draw" };
const SOURCE_WIRE: Record<ArchiveRow["source"], GameRowDTO["source"]> = {
  REPLAY: "replay",
  CHESSCOM: "chesscom",
  LICHESS: "lichess",
};

const roundOrNull = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.min(100, Math.max(0, Math.round(v)));

/** One archive row (GameRowDTO). Only the ref leaves the server. */
export function gameRowOf(row: ArchiveRow, nowMs: number): GameRowDTO {
  const kind = opponentKindOf({ opponentUserId: row.opponentUserId, mode: row.mode, source: row.source, opponentIsLegend: false });
  const name = row.opponentName.trim().slice(0, 120) || (kind === "bot" ? "Engine" : "Opponent");
  const tc = tcOf({ timeClass: row.timeClass, initialTimeSeconds: row.initialTimeSeconds, incrementSeconds: row.incrementSeconds });
  const opening =
    row.ecoCode && /^[A-E]\d{2}$/.test(row.ecoCode) && row.openingName?.trim()
      ? { eco: row.ecoCode, name: row.openingName.trim().slice(0, 120) }
      : null;
  const endedAt = new Date(row.endedAt);
  return {
    ref: row.ref,
    color: row.color,
    result: RESULT_WIRE[row.result],
    opponent: { name, rating: row.opponentRating, kind },
    headline: row.headline ? row.headline.slice(0, 80) : null,
    opening,
    positionTitle: row.positionTitle?.trim() ? row.positionTitle.trim().slice(0, 160) : null,
    tc: { label: tc.label.slice(0, 40), timeClass: tc.timeClass },
    playedAt: endedAt.toISOString(),
    playedAtLabel: playedAtLabelOf(endedAt, nowMs),
    ratingDelta: row.ratingDelta,
    source: SOURCE_WIRE[row.source],
    finalFen: row.fen,
    analysisStatus: STATUS_WIRE[row.analysisStatus],
    momentsCount: Math.min(MAX_MOMENTS, Math.max(0, row.momentsCount)),
    accuracy: roundOrNull(row.accuracy),
    hasComparison: row.hasComparison,
  };
}

export type ArchivePage = { rows: GameRowDTO[]; meta: GamesPageMeta };

/**
 * `meta.counts`: `all`, plus the three source counts once any imported game exists (P4 source tabs). A Replay-only
 * archive keeps P3's `{ all }`: the client reads absent source counts as "everything is Replay Chess".
 */
export function countsOf(c: ArchiveCountsRow): NonNullable<GamesPageMeta["counts"]> {
  const all = Number(c.all);
  const chesscom = c.chesscom === undefined || c.chesscom === null ? 0 : Number(c.chesscom);
  const lichess = c.lichess === undefined || c.lichess === null ? 0 : Number(c.lichess);
  if (chesscom + lichess === 0) return { all };
  const replay = c.replay === undefined || c.replay === null ? Math.max(0, all - chesscom - lichess) : Number(c.replay);
  return { all, replay, chesscom, lichess };
}

/** Page 1 or a count-only request: the totals are part of the answer (AP-38). */
export function countsWanted(req: Pick<ArchiveRequest, "cursor" | "limit">): boolean {
  return req.cursor === null || req.limit === 0;
}

/**
 * G1 / the `/games` first paint: the viewer's own finished games, newest first. One page statement and, on page 1 or
 * with `limit=0`, the counts statement in parallel (only the counts for `limit=0`).
 */
export async function listMyGames(db: GamesDb, viewer: Pick<Viewer, "id">, req: ArchiveRequest, nowMs: number): Promise<ArchivePage> {
  const withCounts = countsWanted(req);
  const [rows, counts] = await Promise.all([
    req.limit > 0
      ? db.$queryRaw<ArchiveRow[]>(archivePageSql(viewer.id, req.filter, req.cursor, req.limit))
      : Promise.resolve([] as ArchiveRow[]),
    withCounts ? db.$queryRaw<ArchiveCountsRow[]>(archiveCountsSql(viewer.id, req.filter)) : Promise.resolve(null),
  ]);
  const page = rows.slice(0, req.limit);
  const nextCursor = req.limit > 0 && rows.length > req.limit ? encodeArchiveCursor(page[page.length - 1]!) : null;
  const meta: GamesPageMeta = { nextCursor };
  if (counts) {
    const c = counts[0] ?? { filteredTotal: 0, all: 0 };
    meta.filteredTotal = Number(c.filteredTotal);
    meta.counts = countsOf(c);
  }
  return { rows: page.map((r) => gameRowOf(r, nowMs)), meta };
}
