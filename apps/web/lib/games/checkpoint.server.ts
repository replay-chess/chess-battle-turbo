// POST /api/games/[ref]/checkpoint: a bot game's journal saved to the server (phase-02 plan §6.6.7, §7.1.3).
//
// One indexed read of the row, then (when it moves the game forward) ONE conditional UPDATE guarded by the journal
// revision, so a late or duplicate beacon never overwrites newer state and an undo (rev++ with fewer moves) is never
// shadowed by an older, longer line. Membership is not re-checked: a beacon from a tab that outlived the session must
// still save. Legality: when the stored move list is a prefix of the new one, only the new suffix is replayed from
// the stored FEN (a few chess.js moves per beacon instead of a 400-ply replay, api-perf AP-32); otherwise the whole
// list is replayed from the start.
import { CHECKPOINT_REV_MAX_GAP, type CheckpointBody } from "@repo/contracts/http/games";
import { Prisma } from "@repo/db";
import { replay as replayMoves, type ReplayResult } from "@repo/game-core/rules/chess";
import { ApiError } from "@/lib/api/api-error";
import { isBotMode, warnSafe } from "./access.server";
import { readGameRow, type GameRow, type GamesDb } from "./snapshot.server";

import type { Side } from "@repo/contracts/socket/game";

/** The wire colour type (one source: `@repo/contracts/socket/game`). */
export type { Side };

export type CheckpointOutcome =
  | { applied: true; plyCount: number }
  /** The write was skipped: a stale rev, or the game is no longer in progress (a late beacon). Still a 204. */
  | { applied: false; reason: "stale_rev" | "not_in_progress" };

export type CheckpointDeps = {
  /** Injected in tests (to count replayed plies). */
  replay?: (startFen: string, moves: readonly string[]) => ReplayResult;
};

const warnedIllegal = new Set<string>();

/** The stored journal revision (meta.rev), 0 when absent. */
export function storedRevOf(meta: unknown): number {
  const rev = meta && typeof meta === "object" ? (meta as { rev?: unknown }).rev : undefined;
  return typeof rev === "number" && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

/** The stored moves as a list ("" → []). */
export function movesOf(stored: string | null | undefined): string[] {
  return stored ? stored.trim().split(/\s+/).filter(Boolean) : [];
}

/** Is `prefix` a (possibly equal) prefix of `full`? */
export function isPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== full[i]) return false;
  return true;
}

/**
 * Each side's remaining ms after its last recorded ply (clocksMs[i] is the mover's clock after ply i). Null for a side
 * with no recorded ply (the stored value is kept).
 */
export function lastClocks(startFen: string, clocksMs: readonly number[]): { w: number | null; b: number | null } {
  const first: Side = startFen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
  const out: { w: number | null; b: number | null } = { w: null, b: null };
  clocksMs.forEach((value, i) => {
    const mover: Side = i % 2 === 0 ? first : first === "w" ? "b" : "w";
    out[mover] = value;
  });
  return out;
}

/** The player's side, or a 403/404/409 for everyone else (§11.1). */
export function assertBotPlayer(row: GameRow | null, viewerId: bigint): { row: GameRow; side: Side } {
  if (!row) throw new ApiError("not_found");
  const side: Side | null = row.whitePlayerId === viewerId ? "w" : row.blackPlayerId === viewerId ? "b" : null;
  if (!side) throw new ApiError("forbidden", { message: "You can't change this game." });
  if (!isBotMode(row.mode)) throw new ApiError("conflict", { details: { reason: "not_bot_game" } });
  return { row, side };
}

/** Validates the body against the stored row and returns what the UPDATE writes (or why it is skipped). */
export function planCheckpoint(
  row: GameRow,
  body: CheckpointBody,
  deps: CheckpointDeps = {},
): { skip: CheckpointOutcome & { applied: false } } | { fen: string; plyCount: number; w: number | null; b: number | null } {
  if (row.status !== "IN_PROGRESS") return { skip: { applied: false, reason: "not_in_progress" } };
  const storedRev = storedRevOf(row.meta);
  if (body.rev <= storedRev) return { skip: { applied: false, reason: "stale_rev" } };
  if (body.rev > storedRev + CHECKPOINT_REV_MAX_GAP) {
    throw new ApiError("conflict", { details: { reason: "rev_gap", storedRev } });
  }
  const replay = deps.replay ?? ((fen: string, moves: readonly string[]) => replayMoves(fen, moves));
  const stored = movesOf(row.moves);
  const suffixOnly = stored.length > 0 && row.fen != null && isPrefix(stored, body.moves);
  const result = suffixOnly ? replay(row.fen!, body.moves.slice(stored.length)) : replay(row.startingFen, body.moves);
  if (!result.ok) {
    if (!warnedIllegal.has(row.referenceId)) {
      warnedIllegal.add(row.referenceId);
      warnSafe("bot checkpoint: illegal moves", { ref: row.referenceId, index: result.index, suffixOnly });
    }
    throw new ApiError("illegal_moves", { details: { index: suffixOnly ? stored.length + result.index : result.index } });
  }
  const clocks = lastClocks(row.startingFen, body.clocksMs);
  return { fen: result.chess.fen(), plyCount: body.moves.length, w: clocks.w, b: clocks.b };
}

/** The guarded UPDATE of plan §6.6.7 (the rev guard makes a concurrent older beacon a no-op). */
export function checkpointSql(gameId: bigint, viewerId: bigint, body: CheckpointBody, plan: { fen: string; plyCount: number; w: number | null; b: number | null }): Prisma.Sql {
  return Prisma.sql`
    UPDATE games SET moves = ${body.moves.join(" ")}, "moveClocksMs" = ${[...body.clocksMs]}::int[],
           "plyCount" = ${plan.plyCount}, fen = ${plan.fen},
           "whiteTimeMs" = COALESCE(${plan.w}::int, "whiteTimeMs"), "blackTimeMs" = COALESCE(${plan.b}::int, "blackTimeMs"),
           meta = jsonb_set(jsonb_set(COALESCE(meta, '{}'::jsonb), '{rev}', to_jsonb(${body.rev}::int)), '{assists}',
                            ${JSON.stringify(body.assists)}::jsonb),
           "lastMoveAt" = now(), "updatedAt" = now()
     WHERE id = ${gameId} AND status = 'IN_PROGRESS' AND mode IN ('BOT', 'LEGEND_BOT')
       AND ("whitePlayerId" = ${viewerId} OR "blackPlayerId" = ${viewerId})
       AND COALESCE((meta->>'rev')::int, 0) < ${body.rev}`;
}

export async function checkpointBotGame(
  db: GamesDb,
  ref: string,
  viewerId: bigint,
  body: CheckpointBody,
  deps: CheckpointDeps = {},
): Promise<CheckpointOutcome> {
  const { row } = assertBotPlayer(await readGameRow(db, ref), viewerId);
  const plan = planCheckpoint(row, body, deps);
  if ("skip" in plan) return plan.skip;
  const n = await db.$executeRaw(checkpointSql(row.id, viewerId, body, plan));
  return n === 1 ? { applied: true, plyCount: plan.plyCount } : { applied: false, reason: "stale_rev" };
}
