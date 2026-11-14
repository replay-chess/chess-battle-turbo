// The solution line of a scored bank puzzle (phase-05 plan §8.1 step 4, research R-PZL-05/06; clean-room from the
// published description of how a puzzle line is grown and cut, CLEANROOM.md "P5").
//
// Start: line = [best] (the move the member missed, already a valid attack, validAttack.ts). Then, while the line is
// shorter than MAX_LINE_PLIES (7 plies = 4 solver moves):
//   1. the defender's reply is the engine's best answer: the next move of the latest principal variation, or, when the
//      variation stops there, the injected `reply` search (MultiPV 1);
//   2. stop on a repetition (a position of the line occurs again) or when the game is over;
//   3. one MultiPV-2 search of the solver's next position (`search`, BANK_LINE_NODES each, at most `maxSearches`);
//   4. stop when the solver is no longer winning enough (below +200 cp without a mate) or the best move is not unique
//      (validAttack); otherwise append the reply and the solver's best move and continue.
// Trim: a line never ends on a defender move; and a final solver move that was forced (one legal move, or no second
// move to compare with) is dropped together with the reply before it, so the last thing the solver plays is a choice.
// The result always has odd length ≥ 1. One-move lines are allowed (own mistakes, R-PZL-06; tagged `oneMove`).
//
// Pure apart from the injected searches: the worker passes its engine (WK/src/extract/lineBuilder.ts), tests a table.

import { Chess } from "chess.js";
import { epdOf } from "../board";
import { hasSecond } from "../codec";
import { validAttack, winsEnough } from "./validAttack";

/** At most 7 plies (4 solver moves). */
export const MAX_LINE_PLIES = 7;
/** Engine searches per line (the solver's positions after the first move): 3 × 500k nodes (§7.6 budget). */
export const MAX_LINE_SEARCHES = 3;
/** Node budget of one line search (env BANK_LINE_NODES overrides it in the worker). */
export const BANK_LINE_NODES = 500_000;

/** One MultiPV-2 search of a solver position. Evals are stored evals (White POV); `second` may be NO_SECOND. */
export interface LineSearchResult {
  best: string | null;
  eval: number;
  second: number;
  /** Principal variation from the searched position, best move first (may be just the best move). */
  pv: readonly string[];
}

export type LineSearch = (fen: string) => Promise<LineSearchResult>;
/** The defender's best move in a position (MultiPV 1), when no variation supplies it. */
export type ReplySearch = (fen: string) => Promise<string | null>;

export type LineStop = "max_plies" | "game_over" | "no_reply" | "repetition" | "budget" | "not_winning" | "not_unique";

export interface ExtendInput {
  /** Position before the solver's first move. */
  fen: string;
  /** The solver's first move (UCI). */
  best: string;
  /** The stored principal variation from `fen` (pass 2), best move first; may hold only the best move. */
  pv: readonly string[];
  search: LineSearch;
  reply?: ReplySearch;
  maxSearches?: number;
}

export interface LineOut {
  /** Odd length, solver moves at even indexes (UCI). */
  line: string[];
  /** Solver searches run (the budget metric `worker.extract.line_searches`). */
  searches: number;
  /** Defender fallback searches run. */
  replySearches: number;
  stop: LineStop;
}

function playUci(chess: Chess, uci: string): boolean {
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Cuts a raw line to the published shape: no trailing defender move, and no final solver move that had no
 * alternative (`forced[k]` for the solver move at index 2k). Never shorter than one move.
 */
export function trimLine(line: readonly string[], forced: readonly boolean[]): string[] {
  let out = line.slice(0, line.length % 2 === 0 ? line.length - 1 : line.length);
  while (out.length > 1 && forced[(out.length - 1) / 2] === true) out = out.slice(0, out.length - 2);
  return out;
}

/** Grows and trims the solution line (see the header). Throws a RangeError when `best` is illegal in `fen`. */
export async function extendLine(input: ExtendInput): Promise<LineOut> {
  const chess = new Chess(input.fen);
  const solver = chess.turn();
  const firstForced = chess.moves().length === 1;
  if (!playUci(chess, input.best)) throw new RangeError(`illegal first move ${input.best} in ${input.fen}`);
  const line = [input.best];
  const forced = [firstForced];
  const seen = new Set([epdOf(input.fen), epdOf(chess.fen())]);
  let tail = input.pv[0] === input.best ? input.pv.slice(1) : [];
  const maxSearches = input.maxSearches ?? MAX_LINE_SEARCHES;
  let searches = 0;
  let replySearches = 0;
  let stop: LineStop = "max_plies";

  while (line.length < MAX_LINE_PLIES) {
    if (chess.isGameOver()) {
      stop = "game_over";
      break;
    }
    let reply = tail[0] ?? null;
    if (!reply && input.reply) {
      replySearches++;
      reply = await input.reply(chess.fen());
    }
    if (!reply || !playUci(chess, reply)) {
      stop = "no_reply";
      break;
    }
    const afterReply = epdOf(chess.fen());
    if (seen.has(afterReply)) {
      stop = "repetition";
      break;
    }
    seen.add(afterReply);
    if (chess.isGameOver()) {
      stop = "game_over";
      break;
    }
    if (searches >= maxSearches) {
      stop = "budget";
      break;
    }
    const legal = chess.moves().length;
    searches++;
    const r = await input.search(chess.fen());
    if (!r.best) {
      stop = "no_reply";
      break;
    }
    if (!winsEnough(r.eval, solver)) {
      stop = "not_winning";
      break;
    }
    if (!validAttack({ best: r.eval, second: r.second, mover: solver })) {
      stop = "not_unique";
      break;
    }
    if (!playUci(chess, r.best)) {
      stop = "no_reply";
      break;
    }
    const afterBest = epdOf(chess.fen());
    if (seen.has(afterBest)) {
      stop = "repetition";
      break;
    }
    seen.add(afterBest);
    line.push(reply, r.best);
    forced.push(legal === 1 || !hasSecond(r.second));
    tail = r.pv[0] === r.best ? r.pv.slice(1) : [];
  }
  return { line: trimLine(line, forced), searches, replySearches, stop };
}
