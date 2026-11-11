// The role-aware game snapshot (phase-02 plan §5.1, §7.1.2). ONE statement after the viewer: `games` by its unique
// ref, LEFT JOIN of both players' `users` (ref, name, avatar) and the parent game's ref for rematches. `gameData`,
// `pgn` and every billing or email column are never read. The display snapshot columns (whiteName/whiteRating/…,
// written at creation and by the backfill) supply names and ratings for the bot side, legacy rows and deleted users.
//
// Used by the RSC page (`getGameSnapshot`, React cache()), GET /api/games/[ref], and the bot routes (checkpoint,
// complete, PGN read the same row through `readGameRow`).
import { cache } from "react";
import { Prisma } from "@repo/db";
import { buildPgn } from "@repo/game-core/pgn";
import { pgnSiteOrigin } from "./site-origin";
import { endMethodFromDb, snapshotOf, winnerFromOutcome, type GameRecord, type GameSnapshot } from "@repo/game-core/snapshot";
import { ApiError } from "@/lib/api/api-error";
import { prisma } from "@/lib/prisma";
import { isFinishedStatus, roleIn, type GameRole } from "./access.server";

export type GamesDb = {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
  $executeRaw(query: Prisma.Sql): PromiseLike<number>;
};

/** The client methods rawDb() needs (PrismaClient, an extended client, or an interactive-transaction client). */
export type UnsafeRawClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PromiseLike<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): PromiseLike<number>;
};

/**
 * A GamesDb (the `SqlClient` shape of @repo/db/games and @repo/db/live) over the client's *Unsafe raw methods. Next
 * bundles @repo/db's generated client apart from the one lib/prisma extends, and Prisma's query-extension argument
 * clone only recognises Sql objects of its own runtime copy: a foreign `Prisma.Sql` loses its `text` getter and fails
 * with "Argument `query` is missing". Sending `(sql.text, ...sql.values)` avoids the class check; the statement stays
 * fully parameterised ($1, $2, …). Every web caller of a Prisma.Sql statement goes through this.
 */
export function rawDb(db: UnsafeRawClient): GamesDb {
  return {
    $queryRaw: <T>(sql: Prisma.Sql) => db.$queryRawUnsafe<T>(sql.text, ...sql.values),
    $executeRaw: (sql: Prisma.Sql) => db.$executeRawUnsafe(sql.text, ...sql.values),
  };
}

/** One `games` row as the services read it (BigInt ids stay server-side; never serialised). */
export type GameRow = {
  id: bigint;
  referenceId: string;
  status: GameRecord["status"];
  mode: GameRecord["mode"];
  rated: boolean;
  timeClass: GameRecord["timeClass"];
  creatorId: bigint;
  opponentId: bigint | null;
  whitePlayerId: bigint | null;
  blackPlayerId: bigint | null;
  botElo: number | null;
  chessPositionId: bigint | null;
  openingId: bigint | null;
  startingFen: string;
  startPly: number;
  studySeconds: number;
  moves: string;
  moveClocksMs: number[] | null;
  plyCount: number;
  fen: string | null;
  initialTimeSeconds: number;
  incrementSeconds: number;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  clockRunning: string | null;
  phase: GameRecord["phase"];
  phaseEndsAt: Date | null;
  lastMoveAt: Date | null;
  endMethod: GameRecord["endMethod"];
  outcome: GameRecord["outcome"];
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  meta: unknown;
  whiteName: string | null;
  blackName: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  rematchOfRef: string | null;
  wRef: string | null;
  wName: string | null;
  wAvatar: string | null;
  bRef: string | null;
  bName: string | null;
  bAvatar: string | null;
};

/** The snapshot read: one statement by the unique ref. */
export function gameRowSql(ref: string): Prisma.Sql {
  return Prisma.sql`
    SELECT g.id, g."referenceId", g.status::text AS status, g.mode::text AS mode, g.rated,
           g."timeClass"::text AS "timeClass", g."creatorId", g."opponentId", g."whitePlayerId", g."blackPlayerId",
           g."botElo", g."chessPositionId", g."openingId", g."startingFen", g."startPly", g."studySeconds", g.moves, g."moveClocksMs", g."plyCount", g.fen,
           g."initialTimeSeconds", g."incrementSeconds", g."whiteTimeMs", g."blackTimeMs", g."clockRunning",
           g.phase::text AS phase, g."phaseEndsAt", g."lastMoveAt", g."endMethod"::text AS "endMethod",
           g.outcome::text AS outcome, g."startedAt", g."completedAt", g."createdAt", g."updatedAt", g.meta,
           g."whiteName", g."blackName", g."whiteRating", g."blackRating",
           r."referenceId" AS "rematchOfRef",
           wu."referenceId" AS "wRef", wu.name AS "wName", wu."profilePictureUrl" AS "wAvatar",
           bu."referenceId" AS "bRef", bu.name AS "bName", bu."profilePictureUrl" AS "bAvatar"
      FROM games g
      LEFT JOIN users wu ON wu.id = g."whitePlayerId"
      LEFT JOIN users bu ON bu.id = g."blackPlayerId"
      LEFT JOIN games r ON r.id = g."rematchOfId"
     WHERE g."referenceId" = ${ref}
     LIMIT 1`;
}

export async function readGameRow(db: GamesDb, ref: string): Promise<GameRow | null> {
  const rows = await db.$queryRaw<GameRow[]>(gameRowSql(ref));
  const row = rows[0];
  return row && typeof row.referenceId === "string" ? row : null;
}

const ms = (d: Date | string | null | undefined): number | null => (d == null ? null : new Date(d).getTime());

/** The meta fields the snapshot reads, taken leniently (a stale sweep may have merged `abortedBy` into a null meta). */
export function looseMeta(raw: unknown): GameRecord["meta"] {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const out: NonNullable<GameRecord["meta"]> = {};
  if (typeof m.header === "string") out.header = m.header;
  if (Array.isArray(m.prefixSan) && m.prefixSan.every((s) => typeof s === "string")) out.prefixSan = m.prefixSan as string[];
  if (typeof m.prefixStartMoveNo === "number") out.prefixStartMoveNo = m.prefixStartMoveNo;
  if (m.position && typeof m.position === "object") out.position = m.position as NonNullable<GameRecord["meta"]>["position"];
  if (typeof m.rev === "number") out.rev = m.rev;
  if (m.drawOffers && typeof m.drawOffers === "object") out.drawOffers = m.drawOffers as { w: number; b: number };
  if (m.abortedBy === "w" || m.abortedBy === "b" || m.abortedBy === "timeout" || m.abortedBy === "stale") out.abortedBy = m.abortedBy;
  return out;
}

/** The plain record game-core maps (dates → epoch ms, no BigInt). */
export function recordOf(row: GameRow): GameRecord {
  return {
    referenceId: row.referenceId,
    status: row.status,
    mode: row.mode,
    rated: row.rated,
    timeClass: row.timeClass,
    startingFen: row.startingFen,
    startPly: row.startPly,
    studySeconds: row.studySeconds,
    moves: row.moves ?? "",
    moveClocksMs: row.moveClocksMs ?? [],
    fen: row.fen,
    initialTimeSeconds: row.initialTimeSeconds,
    incrementSeconds: row.incrementSeconds,
    whiteTimeMs: row.whiteTimeMs,
    blackTimeMs: row.blackTimeMs,
    clockRunning: row.clockRunning,
    phase: row.phase,
    phaseEndsAt: ms(row.phaseEndsAt),
    lastMoveAt: ms(row.lastMoveAt),
    endMethod: row.endMethod,
    outcome: row.outcome,
    completedAt: ms(row.completedAt),
    updatedAt: ms(row.updatedAt) ?? 0,
    botElo: row.botElo,
    rematchOfRef: row.rematchOfRef,
    meta: looseMeta(row.meta),
    white: row.wRef ? { ref: row.wRef, name: row.wName ?? row.whiteName ?? "", avatarUrl: row.wAvatar, rating: row.whiteRating } : null,
    black: row.bRef ? { ref: row.bRef, name: row.bName ?? row.blackName ?? "", avatarUrl: row.bAvatar, rating: row.blackRating } : null,
    whiteName: row.whiteName,
    blackName: row.blackName,
    whiteRating: row.whiteRating,
    blackRating: row.blackRating,
  };
}

export type SnapshotRead = { row: GameRow; role: GameRole; snapshot: GameSnapshot };

/**
 * The row, the viewer's role and the snapshot (player view or the spectator projection). Null for an unknown ref and
 * for a viewer who may not see the game (a bot game of someone else): the caller answers 404 either way, so the
 * existence of a private game is not leaked.
 */
export async function loadGameSnapshot(
  db: GamesDb,
  ref: string,
  viewerId: bigint | null | undefined,
  nowMs: number,
): Promise<SnapshotRead | null> {
  const row = await readGameRow(db, ref);
  if (!row) return null;
  const role = roleIn(row, viewerId);
  if (role.role === "none") return null;
  const snapshot = snapshotOf(
    recordOf(row),
    role.role === "player" ? { role: "player", ...(role.color ? { color: role.color } : {}) } : { role: "spectator" },
    nowMs,
  );
  return { row, role, snapshot };
}

/**
 * The RSC entry (plan §5.1): one query after the viewer, memoised per request with React cache(). Null → notFound().
 * Membership is decided by the page (requireMemberPage with `allowLapsedLivePlayer`).
 */
export const getGameSnapshot = cache(async (ref: string, viewer: { id: bigint } | null, nowMs?: number): Promise<GameSnapshot | null> => {
  if (!viewer) return null;
  const read = await loadGameSnapshot(rawDb(prisma), ref, viewer.id, nowMs ?? Date.now());
  return read?.snapshot ?? null;
});

/** ETag of a finished game's snapshot (`private-etag` tier): stable until the row changes. */
export function snapshotEtag(snapshot: Pick<GameSnapshot, "ref" | "updatedAt">, role: GameRole["role"]): string {
  return `g-${snapshot.ref}-${snapshot.updatedAt}-${role === "spectator" ? "s" : "p"}`;
}

/** `{ siteOrigin }` for buildPgn when this deployment has a configured site (lib/games/site-origin.ts). */
function siteOriginTag(): { siteOrigin?: string } {
  const siteOrigin = pgnSiteOrigin();
  return siteOrigin ? { siteOrigin } : {};
}

/** The PGN download read (plan §7.1.5): players only, finished games only. */
export async function readGamePgn(db: GamesDb, ref: string, viewerId: bigint): Promise<string> {
  const rows = await db.$queryRaw<(GameRow & { pgn: string | null })[]>(Prisma.sql`
    SELECT g.id, g."referenceId", g.status::text AS status, g.mode::text AS mode, g."creatorId", g."opponentId",
           g."whitePlayerId", g."blackPlayerId", g."startingFen", g.moves, g."moveClocksMs", g."initialTimeSeconds",
           g."incrementSeconds", g."timeClass"::text AS "timeClass", g."endMethod"::text AS "endMethod",
           g.outcome::text AS outcome, g."startedAt", g."createdAt", g."whiteName", g."blackName", g."botElo", g.pgn
      FROM games g WHERE g."referenceId" = ${ref} LIMIT 1`);
  const row = rows[0];
  if (!row || typeof row.referenceId !== "string") throw new ApiError("not_found");
  const role = roleIn(row, viewerId);
  if (role.role !== "player") throw new ApiError(role.role === "spectator" ? "forbidden" : "not_found");
  if (!isFinishedStatus(row.status)) throw new ApiError("conflict", { details: { reason: "not_finished" } });
  if (row.pgn) return row.pgn;
  // Aborted and some legacy rows have no stored PGN: build it from the columns (never stored here; GETs do not write).
  const method = endMethodFromDb(row.endMethod);
  const untimed = row.timeClass === "UNTIMED";
  return buildPgn({
    ref: row.referenceId,
    mode: row.mode === "BOT" || row.mode === "LEGEND_BOT" ? "BOT" : row.mode === "ONLINE" || row.mode === "TOURNAMENT" ? row.mode : "FRIEND",
    date: new Date(row.startedAt ?? row.createdAt).getTime(),
    white: row.whiteName ?? "White",
    black: row.blackName ?? "Black",
    startFen: row.startingFen,
    moves: row.moves ?? "",
    clocksMs: untimed ? [] : (row.moveClocksMs ?? []),
    result: method ? { winner: winnerFromOutcome(row.outcome), method } : null,
    tc: untimed ? null : { initialMs: row.initialTimeSeconds * 1000, incrementMs: row.incrementSeconds * 1000 },
    ...siteOriginTag(),
  });
}
