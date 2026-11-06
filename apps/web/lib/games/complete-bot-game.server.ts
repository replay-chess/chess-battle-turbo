// POST /api/games/[ref]/complete: finish a bot game (phase-02 plan §6.6.7, §7.1.4, §8.16).
//
// The browser runs bot games, so the server adjudicates the claim (fixes "bot games trust the browser", SEC-07):
// every move must replay, no position before the last may be terminal, a board-verifiable ending must hold on the
// board, and resignation / timeout / agreement / abort are accepted only within §8.16's limits. A forged result is a
// 422 illegal_moves {details.reason: claim_mismatch}.
//
// The write is the socket's own one-statement finish CTE (`@repo/db/live` finishGame: game + the human's
// game_players row + the human's user_stats + gamesVersion; the bot has no game_players row, so its hot stats row is
// never touched, data-model D2) or abortGame for an abort. Both are idempotent on `status = 'IN_PROGRESS'`, so a
// retried complete returns the stored result (`replayed`), which the route answers with `Idempotent-Replayed: true`.
import type { CompleteBody, CompleteResponse } from "@repo/contracts/http/games";
import { abortGame, finishGame } from "@repo/db/live";
import { adjudicate } from "@repo/game-core/adjudicate";
import { endMethodFromDb } from "@repo/game-core/snapshot";
import { ApiError } from "@/lib/api/api-error";
import { warnSafe } from "./access.server";
import { assertBotPlayer, lastClocks } from "./checkpoint.server";
import { readGameRow, type GameRow, type GamesDb } from "./snapshot.server";

/** `completed`: the props of the `bot_game_completed` event (plan §10.1), set only when this call finished the game. */
export type CompleteOutcome = {
  response: CompleteResponse;
  replayed: boolean;
  completed?: { result: "win" | "loss" | "draw" | "aborted"; method: string; plies: number; hints: number; undos: number };
};

const NONE_ANALYSIS = { status: "none" } as const;

/** The stored end of a finished game as the complete response, or null when it cannot be expressed. */
export function storedResult(row: Pick<GameRow, "status" | "outcome" | "endMethod">): CompleteResponse | null {
  if (row.status === "ABORTED") return { status: "ABORTED", outcome: "NONE", method: "aborted", analysis: NONE_ANALYSIS };
  if (row.status !== "COMPLETED") return null;
  const method = endMethodFromDb(row.endMethod);
  if (!method || !row.outcome) return null;
  return { status: "COMPLETED", outcome: row.outcome, method, analysis: NONE_ANALYSIS };
}

function displayName(row: GameRow, side: "w" | "b"): string {
  const name = side === "w" ? (row.wName ?? row.whiteName) : (row.bName ?? row.blackName);
  return name || (row.botElo != null ? `Engine ${row.botElo}` : "?");
}

export async function completeBotGame(
  db: GamesDb,
  ref: string,
  viewerId: bigint,
  body: CompleteBody,
  now: Date,
): Promise<CompleteOutcome> {
  const { row, side } = assertBotPlayer(await readGameRow(db, ref), viewerId);
  if (row.status !== "IN_PROGRESS") {
    const stored = storedResult(row);
    if (!stored) throw new ApiError("conflict", { details: { reason: "already_completed" } });
    return { response: stored, replayed: true };
  }

  const untimed = row.timeClass === "UNTIMED";
  const verdict = adjudicate({
    startFen: row.startingFen,
    moves: body.moves,
    clocksMs: body.clocksMs,
    initialMs: untimed ? null : row.initialTimeSeconds * 1000,
    incMs: untimed ? 0 : row.incrementSeconds * 1000,
    humanSide: side,
    // Wall time since the start, measured here: a claim that the bot flagged must fit in it (plan 8.16, FIX-A).
    elapsedMs: Math.max(0, now.getTime() - (row.startedAt ?? row.createdAt).getTime()),
    claim: { result: body.result, method: body.method },
    pgn: {
      ref: row.referenceId,
      mode: "BOT",
      date: (row.startedAt ?? row.createdAt).getTime(),
      white: displayName(row, "w"),
      black: displayName(row, "b"),
    },
  });
  if (!verdict.ok) {
    warnSafe("bot complete refused", { ref: row.referenceId, code: verdict.code, reason: verdict.reason, ply: verdict.ply });
    throw new ApiError("illegal_moves", {
      details: verdict.code === "claim_mismatch" ? { reason: "claim_mismatch", why: verdict.reason } : { why: verdict.reason, ply: verdict.ply },
    });
  }

  const moves = body.moves.join(" ");
  const clocks = lastClocks(row.startingFen, body.clocksMs);
  const whiteTimeMs = clocks.w ?? row.whiteTimeMs;
  const blackTimeMs = clocks.b ?? row.blackTimeMs;

  if (verdict.method === "aborted") {
    const res = await abortGame(db, {
      gameId: row.id,
      abortedBy: side,
      endedAt: now,
      moves,
      clocksMs: body.clocksMs,
      plyCount: verdict.plies,
      fen: verdict.finalFen,
      whiteTimeMs,
      blackTimeMs,
    });
    if (!res.aborted) return replayStored(db, ref);
    return {
      response: { status: "ABORTED", outcome: "NONE", method: "aborted", analysis: NONE_ANALYSIS },
      replayed: false,
      completed: { result: "aborted", method: "aborted", plies: verdict.plies, ...body.assists },
    };
  }

  const res = await finishGame(db, {
    gameId: row.id,
    moves,
    clocksMs: body.clocksMs,
    plyCount: verdict.plies,
    fen: verdict.finalFen,
    whiteTimeMs,
    blackTimeMs,
    method: verdict.method,
    winner: verdict.winner,
    pgn: verdict.pgn,
    endedAt: now,
    metaPatch: { rev: Math.max(body.rev, 0), assists: body.assists },
  });
  if (!res.finished) return replayStored(db, ref);
  const result = verdict.winner === null ? "draw" : verdict.winner === side ? "win" : "loss";
  return {
    response: { status: "COMPLETED", outcome: verdict.outcome, method: verdict.method, analysis: NONE_ANALYSIS },
    replayed: false,
    completed: { result, method: verdict.method, plies: verdict.plies, ...body.assists },
  };
}

/** A concurrent complete won the race: answer what it stored. */
async function replayStored(db: GamesDb, ref: string): Promise<CompleteOutcome> {
  const row = await readGameRow(db, ref);
  const stored = row ? storedResult(row) : null;
  if (!stored) throw new ApiError("conflict", { details: { reason: "already_completed" } });
  return { response: stored, replayed: true };
}
