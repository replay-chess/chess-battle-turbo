// Socket finish: ONE data-modifying CTE (phase-02 plan 6.6.4). One round trip from Mumbai (≈ 220–260 ms), atomic,
// and idempotent through the `status = 'IN_PROGRESS'` predicate (fixes DB-04 double counting and socket F-07, the
// lost final move). The bot `complete` route (web) runs the same statement after adjudication.
//
// The statement is built from NAMED fragments so later phases append without editing this file's core:
//   - P3: `"analysisStatus"` in g's SET list + a `jobs` CTE (finish.fragments.p3.ts);
//   - P9: a `ratings` CTE + extra SET items on gp;
//   - P12: arena scoring.
// A fragment is registered with `registerFinishFragment()` at module load of its owner's file.
import { Prisma } from "#generated";
import type { GameMetaV1 } from "../json/game-meta";
import {
  END_METHOD_TO_DB,
  intMs,
  intMsOrNull,
  outcomeOf,
  type GameEndMethod,
  type GameStatus,
  type GameWinner,
  type Side,
  type SqlClient,
  type WireEndMethod,
} from "./types";

export interface FinishGameInput {
  gameId: bigint;
  /** Every ply, including the final one (the finish carries all unflushed plies). */
  moves: string;
  clocksMs: readonly number[];
  plyCount: number;
  /** Final position. */
  fen: string;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  /** Any end method except `aborted` (use `abortGame`). Wire or DB spelling. */
  method: Exclude<WireEndMethod, "aborted"> | Exclude<GameEndMethod, "ABORTED" | "OTHER">;
  /** Winning side; null = a draw. */
  winner: Side | null;
  /** PGN with %clk (game-core `pgn.ts`). Null only when it cannot be built (stale sweep without a builder). */
  pgn: string | null;
  endedAt: Date;
  /** Shallow-merged into `games.meta` (drawOffers, premoves, assists, client). Header/prefix stay as created. */
  metaPatch?: Partial<GameMetaV1>;
  /** Display snapshot for legacy rows whose columns are still NULL (COALESCE; existing values win). */
  display?: { whiteName?: string | null; blackName?: string | null; whiteRating?: number | null; blackRating?: number | null };
}

/** A named piece of the finish statement. Every SQL piece may reference the CTEs `g` and `gp` and the params. */
export interface FinishFragment {
  /** Unique name, e.g. "p3_jobs". Used as the CTE name when `cte` is set. */
  name: string;
  /** Extra `column = expr` items for g's `UPDATE games SET` list. */
  gameSet?: (input: FinishGameInput) => Prisma.Sql[];
  /** Extra `column = expr` items for gp's `UPDATE game_players p SET` list. */
  playerSet?: (input: FinishGameInput) => Prisma.Sql[];
  /** Body of an extra CTE: `<name> AS (<cte>)`. */
  cte?: (input: FinishGameInput) => Prisma.Sql;
  /** Extra columns of the final SELECT, e.g. Prisma.sql`(SELECT count(*) FROM p3_jobs)::int AS queued`. */
  select?: (input: FinishGameInput) => Prisma.Sql[];
}

const fragments: FinishFragment[] = [];

/** Appends a fragment (idempotent by name: re-registering replaces, so hot reloads do not duplicate). */
export function registerFinishFragment(fragment: FinishFragment): void {
  const i = fragments.findIndex((f) => f.name === fragment.name);
  if (i >= 0) fragments[i] = fragment;
  else fragments.push(fragment);
}

export function finishFragments(): readonly FinishFragment[] {
  return fragments;
}

function methodOf(method: FinishGameInput["method"]): GameEndMethod {
  const db = (END_METHOD_TO_DB as Record<string, GameEndMethod>)[method] ?? (method as GameEndMethod);
  if (db === "ABORTED" || db === "OTHER") throw new Error(`finishGame: method ${db} is not a finish (use abortGame)`);
  return db;
}

/** Builds the statement. Exported for EXPLAIN and the tests. */
export function finishGameSql(input: FinishGameInput, extra: readonly FinishFragment[] = fragments): Prisma.Sql {
  const method = methodOf(input.method);
  const outcome: GameWinner = outcomeOf(input.winner);
  const metaPatch = JSON.stringify(input.metaPatch ?? {});
  const d = input.display ?? {};
  const isTimeout = method === "TIMEOUT";

  const gameSet: Prisma.Sql[] = [
    Prisma.sql`status = 'COMPLETED'`,
    Prisma.sql`phase = 'ENDED'`,
    Prisma.sql`"phaseEndsAt" = NULL`,
    Prisma.sql`"clockRunning" = NULL`,
    Prisma.sql`moves = ${input.moves}`,
    Prisma.sql`"moveClocksMs" = ${input.clocksMs.map(intMs)}::int[]`,
    Prisma.sql`"plyCount" = ${input.plyCount}`,
    Prisma.sql`fen = ${input.fen}`,
    Prisma.sql`"whiteTimeMs" = ${intMsOrNull(input.whiteTimeMs)}::int`,
    Prisma.sql`"blackTimeMs" = ${intMsOrNull(input.blackTimeMs)}::int`,
    Prisma.sql`"endMethod" = ${method}::"GameEndMethod"`,
    Prisma.sql`outcome = ${outcome}::"GameWinner"`,
    Prisma.sql`pgn = ${input.pgn}::text`,
    // Legacy readers (profile, stats, analysis) until they read the typed columns. The winner's colour decides,
    // never the creator flag (fixes the wrong-winner forfeit, socket F-10). SET expressions see the old row.
    Prisma.sql`"winnerId" = CASE ${outcome}::text WHEN 'WHITE' THEN "whitePlayerId" WHEN 'BLACK' THEN "blackPlayerId" END`,
    Prisma.sql`result = (CASE
        WHEN ${outcome}::text = 'DRAW' THEN 'DRAW'
        WHEN (CASE ${outcome}::text WHEN 'WHITE' THEN "whitePlayerId" ELSE "blackPlayerId" END) IS NOT DISTINCT FROM "creatorId"
          THEN CASE WHEN ${isTimeout}::boolean THEN 'OPPONENT_TIMEOUT' ELSE 'CREATOR_WON' END
        ELSE CASE WHEN ${isTimeout}::boolean THEN 'CREATOR_TIMEOUT' ELSE 'OPPONENT_WON' END
      END)::"GameResult"`,
    Prisma.sql`"creatorTimeRemaining" = COALESCE(CASE WHEN "blackPlayerId" = "creatorId" THEN ${intMsOrNull(input.blackTimeMs)}::int ELSE ${intMsOrNull(input.whiteTimeMs)}::int END / 1000, "creatorTimeRemaining")`,
    Prisma.sql`"opponentTimeRemaining" = COALESCE(CASE WHEN "blackPlayerId" = "creatorId" THEN ${intMsOrNull(input.whiteTimeMs)}::int ELSE ${intMsOrNull(input.blackTimeMs)}::int END / 1000, "opponentTimeRemaining")`,
    Prisma.sql`meta = COALESCE(meta, '{}'::jsonb) || ${metaPatch}::jsonb`,
    Prisma.sql`"completedAt" = ${input.endedAt}::timestamp(3)`,
    Prisma.sql`"lastMoveAt" = ${input.endedAt}::timestamp(3)`,
    Prisma.sql`"updatedAt" = now()`,
    Prisma.sql`"whiteName" = COALESCE("whiteName", ${d.whiteName ?? null}::varchar(40))`,
    Prisma.sql`"blackName" = COALESCE("blackName", ${d.blackName ?? null}::varchar(40))`,
    Prisma.sql`"whiteRating" = COALESCE("whiteRating", ${d.whiteRating ?? null}::smallint)`,
    Prisma.sql`"blackRating" = COALESCE("blackRating", ${d.blackRating ?? null}::smallint)`,
    ...extra.flatMap((f) => f.gameSet?.(input) ?? []),
  ];

  const playerSet: Prisma.Sql[] = [
    Prisma.sql`result = CASE WHEN ${outcome}::text = 'DRAW' THEN 'DRAW'::"PlayerResult"
                             WHEN (p.color = 'w') = (${outcome}::text = 'WHITE') THEN 'WIN'::"PlayerResult"
                             ELSE 'LOSS'::"PlayerResult" END`,
    Prisma.sql`"endedAt" = ${input.endedAt}::timestamp(3)`,
    Prisma.sql`"updatedAt" = now()`,
    ...extra.flatMap((f) => f.playerSet?.(input) ?? []),
  ];

  const ctes: Prisma.Sql[] = [
    Prisma.sql`g AS (
      UPDATE games SET ${Prisma.join(gameSet, ", ")}
       WHERE id = ${input.gameId} AND status = 'IN_PROGRESS'
      RETURNING id, "tournamentId"
    )`,
    Prisma.sql`gp AS (
      UPDATE game_players p SET ${Prisma.join(playerSet, ", ")}
        FROM g WHERE p."gameId" = g.id
      RETURNING p."userId", p.result
    )`,
    // Legacy user_stats until P10 derives stats from game_players. The bot never has a game_players row, so its
    // (hot) stats row is never touched (data-model D2).
    Prisma.sql`us AS (
      UPDATE user_stats s
         SET "totalGamesPlayed" = s."totalGamesPlayed" + 1, "lastPlayedAt" = ${input.endedAt}::timestamp(3),
             "gamesWon"   = s."gamesWon"   + (gp.result = 'WIN')::int,
             "gamesLost"  = s."gamesLost"  + (gp.result = 'LOSS')::int,
             "gamesDrawn" = s."gamesDrawn" + (gp.result = 'DRAW')::int,
             "currentWinStreak" = CASE WHEN gp.result = 'WIN' THEN s."currentWinStreak" + 1 ELSE 0 END,
             "longestWinStreak" = CASE WHEN gp.result = 'WIN' THEN GREATEST(s."longestWinStreak", s."currentWinStreak" + 1)
                                       ELSE s."longestWinStreak" END,
             "updatedAt" = now()
        FROM gp WHERE s."userId" = gp."userId"
      RETURNING s."userId"
    )`,
    // Legacy arena standings until P12.
    Prisma.sql`tp AS (
      UPDATE tournament_participants t
         SET points = t.points + CASE gp.result WHEN 'WIN' THEN 1 WHEN 'DRAW' THEN 0.5 ELSE 0 END,
             wins = t.wins + (gp.result = 'WIN')::int, draws = t.draws + (gp.result = 'DRAW')::int,
             losses = t.losses + (gp.result = 'LOSS')::int, "gamesPlayed" = t."gamesPlayed" + 1,
             "updatedAt" = now()
        FROM gp, g WHERE g."tournamentId" IS NOT NULL AND t."tournamentId" = g."tournamentId" AND t."userId" = gp."userId"
      RETURNING t."userId"
    )`,
    // Archive/Home ETag version (api-perf AP-19): once per member per finished game.
    Prisma.sql`uv AS (
      UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
        FROM gp WHERE u.id = gp."userId"
      RETURNING u.id
    )`,
    ...extra.flatMap((f) => (f.cte ? [Prisma.sql`${Prisma.raw(quoteIdent(f.name))} AS (${f.cte(input)})`] : [])),
  ];

  const select: Prisma.Sql[] = [
    Prisma.sql`(SELECT count(*) FROM g)::int AS finished`,
    Prisma.sql`(SELECT count(*) FROM gp)::int AS players`,
    Prisma.sql`(SELECT count(*) FROM tp)::int AS standings`,
    Prisma.sql`(SELECT count(*) FROM uv)::int AS versions`,
    ...extra.flatMap((f) => f.select?.(input) ?? []),
  ];

  return Prisma.sql`WITH ${Prisma.join(ctes, ",\n")}\nSELECT ${Prisma.join(select, ", ")}`;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`finish fragment name must be a lower-case identifier: ${name}`);
  return name;
}

export interface FinishGameResult {
  /** true: this call finished the game. false: it was already finished (or not IN_PROGRESS). */
  finished: boolean;
  /** Members whose game_players row was written (0–2). */
  players: number;
  /** Tournament standings rows updated (legacy arena). */
  standings: number;
  /** When `finished` is false: the stored end, for the caller's comparison. */
  stored?: { status: GameStatus; endMethod: GameEndMethod | null; outcome: GameWinner | null };
  /**
   * When `finished` is false: true if the stored end differs from this call (log `ws.persist.conflict`; the DB
   * wins). A retry after a lost response has `conflict: false` and counts as success.
   */
  conflict: boolean;
  /** Extra columns selected by fragments (e.g. P3's `queued`). */
  extra: Record<string, unknown>;
}

export async function finishGame(db: SqlClient, input: FinishGameInput): Promise<FinishGameResult> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(finishGameSql(input));
  const row = rows[0] ?? {};
  const { finished, players, standings, ...rest } = row as {
    finished?: number;
    players?: number;
    standings?: number;
  } & Record<string, unknown>;
  const extra = Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "versions"));
  if (finished === 1) {
    return { finished: true, players: players ?? 0, standings: standings ?? 0, conflict: false, extra };
  }
  const stored = await readEnd(db, input.gameId);
  const method = methodOf(input.method);
  const conflict = !stored || stored.status !== "COMPLETED" || stored.endMethod !== method || stored.outcome !== outcomeOf(input.winner);
  return { finished: false, players: 0, standings: 0, conflict, extra, ...(stored ? { stored } : {}) };
}

export async function readEnd(
  db: SqlClient,
  gameId: bigint,
): Promise<{ status: GameStatus; endMethod: GameEndMethod | null; outcome: GameWinner | null } | null> {
  const rows = await db.$queryRaw<{ status: GameStatus; endMethod: GameEndMethod | null; outcome: GameWinner | null }[]>(
    Prisma.sql`SELECT status::text AS status, "endMethod"::text AS "endMethod", outcome::text AS outcome FROM games WHERE id = ${gameId}`,
  );
  return rows[0] ?? null;
}
