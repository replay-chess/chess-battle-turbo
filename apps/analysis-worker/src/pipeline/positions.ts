// What the engine is asked about each position of a game (phase-03 plan §8.12 steps 2 and 5).
//
// Position i is the position before ply i (§8.1); position n is the final one. For each:
// - `terminal`: the final position when the game ended in checkmate (stored eval = mate for the side that just
//   moved, `encodeMate(winner, 0)`) or in a draw the rules end (stalemate, insufficient material, threefold, the
//   50-move rule): 0. Terminal positions are never searched (§8.12 "Terminal position").
// - the search start: the FEN at `lastIrreversible[i]` (the last position whose half-move clock is 0) and the UCI
//   moves played since, so the engine sees repetitions;
// - the cache rule inputs: the half-move clock and whether the EPD occurred earlier in the game (cache.ts).
import { NO_SECOND, encodeMate, moverAt, type Color } from "@repo/chess-analysis/codec";
import { isInitialPosition } from "@repo/chess-analysis/board";
import type { Replay } from "@repo/chess-analysis/replay";

export interface PositionPlan {
  index: number;
  fen: string;
  epd: string;
  mover: Color;
  /** Stored eval of a terminal position (never searched), else null. */
  terminal: number | null;
  searchFen: string;
  searchMoves: string[];
  halfmoveClock: number;
  seenEarlier: boolean;
}

function halfmoveOf(fen: string): number {
  const n = Number(fen.trim().split(/\s+/)[4] ?? "0");
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** The plan of every position 0 … n of a replayed game. */
export function planPositions(replay: Replay): PositionPlan[] {
  const n = replay.uci.length;
  const out: PositionPlan[] = [];
  const seen = new Set<string>();
  let lastIrreversible = 0;
  for (let i = 0; i <= n; i++) {
    const fen = replay.fens[i] as string;
    const epd = replay.epds[i] as string;
    const halfmoveClock = halfmoveOf(fen);
    if (i > 0 && halfmoveClock === 0) lastIrreversible = i;
    let terminal: number | null = null;
    if (i === n) {
      if (replay.final.checkmate) terminal = encodeMate(moverAt(n - 1, replay.startMover), 0);
      else if (replay.final.draw || replay.final.stalemate) terminal = 0;
    }
    out.push({
      index: i,
      fen,
      epd,
      mover: moverAt(i, replay.startMover),
      terminal,
      searchFen: replay.fens[lastIrreversible] as string,
      searchMoves: replay.uci.slice(lastIrreversible, i),
      halfmoveClock,
      seenEarlier: seen.has(epd),
    });
    seen.add(epd);
  }
  return out;
}

/** Was the game started from the standard initial position (the cache's seed rule)? */
export function fromInitialPosition(replay: Replay): boolean {
  return isInitialPosition(replay.startFen);
}

/** The values a terminal position stores. */
export function terminalEval(value: number): { eval: number; second: number; best: number; depth: number } {
  return { eval: value, second: NO_SECOND, best: 0, depth: 0 };
}
