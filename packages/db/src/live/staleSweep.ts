// Stale live-game sweep (phase-02 plan 6.6.8, owner Q7). Runs at socket boot and opportunistically right after a
// finish (Neon is awake then), at most once per 10 min. NEVER on a timer: any query within 5 min keeps the Neon
// compute from scaling to zero. Served by the partial games_open_idx.
//
// Rule (Q7): a live human game the socket does not hold in memory is aborted after 30 min without a ply when fewer
// than 2 plies were played, and abandoned (the side to move loses) after 2 h otherwise. Daily bot-game sweep: web
// cron (`staleBotSweepSql`).
import { Prisma } from "#generated";
import { sideToMoveAfter, sideToMoveOf } from "../games/derive";
import { abortGame } from "./abort";
import { finishGame } from "./finish";
import type { Side, SqlClient } from "./types";

/** `STALE_LIVE_MS` (plan 8.20): < 2 plies → abort after 30 min; ≥ 2 plies → abandon after 2 h. */
export const STALE_ABORT_MS = 30 * 60 * 1000;
export const STALE_ABANDON_MS = 2 * 60 * 60 * 1000;
/** `STALE_BOT_DAYS`. */
export const STALE_BOT_DAYS = 7;

export interface StaleRow {
  id: bigint;
  ref: string;
  plyCount: number;
  fen: string | null;
  startingFen: string;
  moves: string;
  moveClocksMs: number[] | null;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
}

export interface StaleSweepOptions {
  /** Refs held by this socket process (never swept). */
  liveRefs: readonly string[];
  limit?: number;
  abortAfterMs?: number;
  abandonAfterMs?: number;
  /** Builds the PGN of an abandoned game (game-core `pgn.ts`); without it the PGN stays NULL. */
  pgnFor?: (row: StaleRow, loser: Side) => string | null;
  now?: () => Date;
}

export interface StaleSweepResult {
  aborted: string[];
  abandoned: string[];
}

export function staleCandidatesSql(opts: Required<Pick<StaleSweepOptions, "liveRefs" | "limit" | "abortAfterMs" | "abandonAfterMs">>): Prisma.Sql {
  return Prisma.sql`
    SELECT id, "referenceId" AS ref, "plyCount", fen, "startingFen", moves, "moveClocksMs", "whiteTimeMs", "blackTimeMs"
      FROM games
     WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT')
       AND "lastMoveAt" < now() - (${opts.abortAfterMs}::int * interval '1 millisecond')
       AND ("plyCount" < 2 OR "lastMoveAt" < now() - (${opts.abandonAfterMs}::int * interval '1 millisecond'))
       AND NOT ("referenceId" = ANY(${[...opts.liveRefs]}::text[]))
     LIMIT ${opts.limit}`;
}

export async function staleSweep(db: SqlClient, options: StaleSweepOptions): Promise<StaleSweepResult> {
  const now = options.now ?? (() => new Date());
  const rows = await db.$queryRaw<StaleRow[]>(
    staleCandidatesSql({
      liveRefs: options.liveRefs,
      limit: options.limit ?? 50,
      abortAfterMs: options.abortAfterMs ?? STALE_ABORT_MS,
      abandonAfterMs: options.abandonAfterMs ?? STALE_ABANDON_MS,
    }),
  );
  const result: StaleSweepResult = { aborted: [], abandoned: [] };
  for (const row of rows) {
    if (row.plyCount < 2) {
      const r = await abortGame(db, { gameId: row.id, abortedBy: "stale", endedAt: now() });
      if (r.aborted) result.aborted.push(row.ref);
      continue;
    }
    const loser: Side = row.fen ? sideToMoveOf(row.fen) : sideToMoveAfter(row.startingFen, row.plyCount);
    const r = await finishGame(db, {
      gameId: row.id,
      moves: row.moves,
      clocksMs: row.moveClocksMs ?? [],
      plyCount: row.plyCount,
      fen: row.fen ?? row.startingFen,
      whiteTimeMs: row.whiteTimeMs,
      blackTimeMs: row.blackTimeMs,
      method: "abandoned",
      winner: loser === "w" ? "b" : "w",
      pgn: options.pgnFor?.(row, loser) ?? null,
      endedAt: now(),
    });
    if (r.finished) result.abandoned.push(row.ref);
  }
  return result;
}

/**
 * Web daily cron (P1 CRON-1): stale bot games → ABORTED, their game_players rows ended, `gamesVersion` bumped once
 * per member. One statement. Run with `$queryRaw`; returns `{ aborted }`.
 */
export function staleBotSweepSql(days: number = STALE_BOT_DAYS): Prisma.Sql {
  return Prisma.sql`
    WITH g AS (
      UPDATE games SET status = 'ABORTED', phase = 'ENDED', "endMethod" = 'ABORTED', outcome = 'NONE',
             "clockRunning" = NULL, "phaseEndsAt" = NULL,
             meta = COALESCE(meta, '{}'::jsonb) || '{"abortedBy":"stale"}'::jsonb,
             "completedAt" = now(), "updatedAt" = now(), "analysisStatus" = 'SKIPPED'
       WHERE status = 'IN_PROGRESS' AND mode = 'BOT' AND "lastMoveAt" < now() - (${days}::int * interval '1 day')
      RETURNING id
    ), gp AS (
      UPDATE game_players SET result = 'ABORTED', "endedAt" = now(), "updatedAt" = now()
        FROM g WHERE game_players."gameId" = g.id
      RETURNING game_players."userId"
    ), uv AS (
      UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
        FROM (SELECT DISTINCT "userId" FROM gp) x WHERE u.id = x."userId"
      RETURNING u.id
    )
    SELECT (SELECT count(*) FROM g)::int AS aborted`;
}
