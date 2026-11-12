// Abort (phase-02 plan 6.6.5): the finish shape with status ABORTED, endMethod ABORTED, outcome NONE, no legacy
// result, game_players.result = ABORTED, meta.abortedBy, and NO user_stats or standings clause (an aborted game is
// excluded from stats). The game leaves the members' live lists, so `gamesVersion` is bumped like a finish.
// Writes `ABORTED` to GameStatus: only after M2a has been deployed for one release (two-release rule).
import { Prisma } from "#generated";
import type { AbortedBy } from "../json/game-meta";
import type { GameStatus, SqlClient } from "./types";

export interface AbortGameInput {
  gameId: bigint;
  /** "w"/"b": that side aborted (first-move window); "timeout": no first move; "stale": sweep or corrupt restore. */
  abortedBy: AbortedBy;
  endedAt: Date;
  /** Optional final state (≤ 1 ply was played). Omitted fields keep the stored values. */
  moves?: string;
  clocksMs?: readonly number[];
  plyCount?: number;
  fen?: string;
  whiteTimeMs?: number | null;
  blackTimeMs?: number | null;
}

export interface AbortGameResult {
  /** true: this call aborted the game. false: it was not IN_PROGRESS (already ended or aborted). */
  aborted: boolean;
  players: number;
  /** When `aborted` is false: the stored status. */
  storedStatus?: GameStatus;
}

export function abortGameSql(input: AbortGameInput): Prisma.Sql {
  const meta = JSON.stringify({ abortedBy: input.abortedBy });
  const clocks = input.clocksMs ? [...input.clocksMs] : null;
  return Prisma.sql`
    WITH g AS (
      UPDATE games SET status = 'ABORTED', phase = 'ENDED', "phaseEndsAt" = NULL, "clockRunning" = NULL,
             "endMethod" = 'ABORTED', outcome = 'NONE', result = NULL, "winnerId" = NULL,
             moves = COALESCE(${input.moves ?? null}::text, moves),
             "moveClocksMs" = COALESCE(${clocks}::int[], "moveClocksMs"),
             "plyCount" = COALESCE(${input.plyCount ?? null}::smallint, "plyCount"),
             fen = COALESCE(${input.fen ?? null}::text, fen),
             "whiteTimeMs" = COALESCE(${input.whiteTimeMs ?? null}::int, "whiteTimeMs"),
             "blackTimeMs" = COALESCE(${input.blackTimeMs ?? null}::int, "blackTimeMs"),
             meta = COALESCE(meta, '{}'::jsonb) || ${meta}::jsonb,
             "completedAt" = ${input.endedAt}::timestamp(3), "updatedAt" = now(),
             "analysisStatus" = 'SKIPPED'
       WHERE id = ${input.gameId} AND status = 'IN_PROGRESS'
      RETURNING id
    ), gp AS (
      UPDATE game_players p SET result = 'ABORTED', "endedAt" = ${input.endedAt}::timestamp(3), "updatedAt" = now()
        FROM g WHERE p."gameId" = g.id
      RETURNING p."userId"
    ), uv AS (
      UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
        FROM gp WHERE u.id = gp."userId"
      RETURNING u.id
    )
    SELECT (SELECT count(*) FROM g)::int AS aborted, (SELECT count(*) FROM gp)::int AS players`;
}

export async function abortGame(db: SqlClient, input: AbortGameInput): Promise<AbortGameResult> {
  const rows = await db.$queryRaw<{ aborted: number; players: number }[]>(abortGameSql(input));
  const row = rows[0];
  if (row && row.aborted === 1) return { aborted: true, players: row.players };
  const stored = await db.$queryRaw<{ status: GameStatus }[]>(
    Prisma.sql`SELECT status::text AS status FROM games WHERE id = ${input.gameId}`,
  );
  return { aborted: false, players: 0, ...(stored[0] ? { storedStatus: stored[0].status } : {}) };
}
