// Loader for the accuracy oracle (`fixtures/oracle/*.json`, written by `scripts/fetch-oracle.ts`; phase-03 plan
// §8.2 R-ACC-05, §12.4). Converts Lichess's published per-ply evals to our stored encoding (codec.ts).
//
// Lichess's `analysis[k]` is the eval of the position AFTER ply k, White POV: `{eval: cp}` or `{mate: n}` with the
// sign naming the side that mates, and `{mate: 0}` for a final checkmate (the side to move is mated, so the player
// who made ply k won). Lichess does not publish the eval of the start position: `START_POSITION_EVAL` stands in.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { START_POSITION_EVAL } from "../src/accuracy";
import { INITIAL_FEN } from "../src/board";
import { encodeCp, encodeMate, encodeMove, moverAt } from "../src/codec";
import { normalizeUci, replaySan, type Replay } from "../src/replay";
import type { OracleEval, OracleGame } from "../scripts/fetch-oracle";

export type { OracleEval, OracleGame } from "../scripts/fetch-oracle";

export const ORACLE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "oracle");

export function loadOracleGames(): OracleGame[] {
  return readdirSync(ORACLE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(path.join(ORACLE_DIR, f), "utf8")) as Omit<OracleGame, "moves"> & {
        moves: string;
      };
      return { ...raw, moves: raw.moves.split(" ") };
    });
}

/** One Lichess analysis entry (the position after ply k) → stored eval. */
export function oracleEval(e: OracleEval, k: number): number {
  if ("eval" in e) return encodeCp(e.eval);
  if (e.mate === 0) return encodeMate(moverAt(k, "w"), 0);
  return encodeMate(e.mate > 0 ? "w" : "b", Math.abs(e.mate));
}

/** Stored evals of positions 0 … analysis.length (position 0 = START_POSITION_EVAL). */
export function oracleEvals(g: OracleGame): number[] {
  return [START_POSITION_EVAL, ...g.analysis.map(oracleEval)];
}

export function oracleReplay(g: OracleGame): Replay {
  return replaySan(INITIAL_FEN, g.moves);
}

/** MoveCode per position from Lichess's `best` (published on judged plies only; 0 elsewhere). */
export function oracleBest(g: OracleGame, replay: Replay): number[] {
  return g.moves.map((_, i) => {
    const b = g.analysis[i]?.best;
    return b ? encodeMove(normalizeUci(replay.fens[i] as string, b)) : 0;
  });
}
