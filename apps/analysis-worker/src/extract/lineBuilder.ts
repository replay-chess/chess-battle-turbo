// The engine side of a bank puzzle's line extension (phase-05 plan §8.1 step 4, §7.6 budget): the searches
// @repo/chess-analysis/puzzle/line asks for, run through the pipeline's Searcher (eval cache first, then the engine,
// with the lag pause before every search). The solver's positions get one MultiPV-2 search at BANK_LINE_NODES; the
// defender's reply comes from the principal variation, or, when it stops early, one MultiPV-1 search at the same budget.
// A SIGTERM between searches stops the job at once (JobAborted): the analysis is released and resumed later.
import { epdOf } from "@repo/chess-analysis/board";
import { decodeMove, NO_SECOND, type Color } from "@repo/chess-analysis/codec";
import type { LineSearch, LineSearchResult, ReplySearch } from "@repo/chess-analysis/puzzle/line";
import { Chess } from "chess.js";
import { throwIfAborted } from "../jobs/types";
import type { PositionPlan } from "../pipeline/positions";
import type { Searcher } from "../pipeline/search";

/** A searchable plan for a position outside the game's own move list (no history: it is a fresh position). */
export function linePosition(fen: string): PositionPlan {
  const chess = new Chess(fen);
  const parts = fen.trim().split(/\s+/);
  const halfmove = Number(parts[4] ?? "0");
  return {
    index: -1,
    fen,
    epd: epdOf(fen),
    mover: chess.turn() as Color,
    terminal: null,
    searchFen: fen,
    searchMoves: [],
    halfmoveClock: Number.isInteger(halfmove) && halfmove >= 0 ? halfmove : 0,
    seenEarlier: false,
  };
}

export interface LineSearchers {
  search: LineSearch;
  reply: ReplySearch;
  /** Searches started (both kinds), for `worker.extract.line_searches`. */
  readonly count: () => number;
}

export function lineSearchers(searcher: Searcher, nodes: number, signal: AbortSignal): LineSearchers {
  let count = 0;
  const search: LineSearch = async (fen) => {
    throwIfAborted(signal);
    count++;
    const e = await searcher.evaluate(linePosition(fen), { nodes, multipv: 2 }, { pass1: false });
    const best = e.bestUci ?? decodeMove(e.best);
    const out: LineSearchResult = {
      best,
      eval: e.eval,
      second: e.second ?? NO_SECOND,
      pv: e.lines[0]?.pv ?? (best ? [best] : []),
    };
    return out;
  };
  const reply: ReplySearch = async (fen) => {
    throwIfAborted(signal);
    count++;
    const e = await searcher.evaluate(linePosition(fen), { nodes, multipv: 1 }, { pass1: false });
    return e.bestUci ?? decodeMove(e.best);
  };
  return { search, reply, count: () => count };
}
