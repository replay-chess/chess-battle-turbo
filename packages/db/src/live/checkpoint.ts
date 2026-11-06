// Socket checkpoint (phase-02 plan 6.6.3): ≤ 10 per 80-ply game, one statement, ~220 ms from Mumbai.
//
// The full move list is sent each time (≈ 400 B UCI + ≈ 350 B clocks at 80 plies), so a checkpoint is an idempotent
// overwrite. `"plyCount" <= $n` makes a reordered or duplicate write a no-op and allows a same-ply write that only
// changes clocks or the phase (the drain freeze). Only `status = 'IN_PROGRESS'` rows are written, and nothing indexed
// changes, so on the `fillfactor = 90` table every checkpoint stays a HOT update.
import { Prisma } from "#generated";
import { PHASE_TO_DB, intMs, intMsOrNull, type LivePhase, type Side, type SqlClient, type WirePhase } from "./types";

export interface CheckpointInput {
  gameId: bigint;
  /** Space-separated UCI of every ply from startingFen. */
  moves: string;
  /** Mover's remaining ms after each ply (empty for untimed games). */
  clocksMs: readonly number[];
  plyCount: number;
  /** Position after the last ply. */
  fen: string;
  whiteTimeMs: number | null;
  blackTimeMs: number | null;
  /** Side whose clock runs since `lastMoveAt`, or null (frozen, study, first-move window). */
  clockRunning: Side | null;
  phase: LivePhase | WirePhase;
  /** Study end or first-move deadline. */
  phaseEndsAt: Date | null;
  /** Time of the last ply (or the phase change). */
  lastMoveAt: Date;
}

export interface CheckpointResult {
  /** false: the game is no longer IN_PROGRESS, or the stored plyCount is already higher (a no-op). */
  applied: boolean;
}

function phaseOf(phase: LivePhase | WirePhase): LivePhase {
  return (PHASE_TO_DB as Record<string, LivePhase>)[phase] ?? (phase as LivePhase);
}

export function checkpointSql(input: CheckpointInput): Prisma.Sql {
  return Prisma.sql`
    UPDATE games SET moves = ${input.moves}, "moveClocksMs" = ${input.clocksMs.map(intMs)}::int[], "plyCount" = ${input.plyCount},
           fen = ${input.fen}, "whiteTimeMs" = ${intMsOrNull(input.whiteTimeMs)}::int, "blackTimeMs" = ${intMsOrNull(input.blackTimeMs)}::int,
           "clockRunning" = ${input.clockRunning}::char(1), phase = ${phaseOf(input.phase)}::"LivePhase",
           "phaseEndsAt" = ${input.phaseEndsAt}::timestamp(3), "lastMoveAt" = ${input.lastMoveAt}::timestamp(3),
           "updatedAt" = now()
     WHERE id = ${input.gameId} AND status = 'IN_PROGRESS' AND "plyCount" <= ${input.plyCount}
    RETURNING "plyCount"`;
}

export async function checkpointGame(db: SqlClient, input: CheckpointInput): Promise<CheckpointResult> {
  const rows = await db.$queryRaw<{ plyCount: number }[]>(checkpointSql(input));
  return { applied: rows.length === 1 };
}

/**
 * Prewarm (plan 6.7 rule 4): when a game leaves `waiting` or `study`, the outbox sends a fire-and-forget `SELECT 1`
 * so the first checkpoint does not also pay the ≈ 1 s compute wake. Never rejects.
 */
export function prewarm(db: SqlClient): Promise<void> {
  return Promise.resolve(db.$queryRaw(Prisma.sql`SELECT 1`)).then(
    () => undefined,
    () => undefined,
  );
}
