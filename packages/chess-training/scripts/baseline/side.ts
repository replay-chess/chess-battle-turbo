// One sampled player side through the worker's own pipeline (phase-06 plan §7.4.5 step 4). Pure: the engine's answers
// are handed in, so the same code runs on the live engine (build-baseline.ts --grade), on the stored answers of the
// committed fixture (FX weakness/baseline-sample.json) and in the tests.
//
//   prepareSide   PGN → the rows the importer would store (moves as UCI, `moveClocksMs` from %clk, the time control)
//                 and the analysis the worker writes for an imported Lichess game whose export evaluated every ply
//                 (WK import/eval-hint.ts): evals 1…n from %eval (the importer's evalHintOf encoding: cp clamped to
//                 ±9999, mate n = sign·(30000 − n), a final mate completed), position 0 from our engine, P3's terminal
//                 values, `second`/`best` unknown; graded by CA gradeAnalysis with the worker's opening book. Returns
//                 the positions the engine must search: for every MISTAKE / BLUNDER / MISS of the side, the position
//                 before it (its best line feeds the tagger) and the one after it (the opponent's best reply feeds
//                 rc:missedThreat), searched from the last irreversible position like the worker's pass 1.
//   finishSide    + the engine's answers → CA computeSideInputs (STATS_V1, ERROR_LOG_V1, the P5 tagger's themes):
//                 exactly the five `game_players` columns the worker's final batch writes, plus the per-phase accuracy.
//   calibrationCounts  the same side graded twice: from %eval (above) and from our engine on every position (R-WK-03).
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import type { BookSet } from "@repo/chess-analysis/book";
import { J, MOVE_UNKNOWN, NO_SECOND, encodeMate, encodeMove, errorJudgementOf, fromEngineScore, moverAt, type Color } from "@repo/chess-analysis/codec";
import { replaySan, type Replay } from "@repo/chess-analysis/replay";
import { computeSideInputs, type SideInputs, type SideInputsAnalysis, type SideInputsGame } from "@repo/chess-analysis/weakness-inputs";
import { clockOf, parseMovetext, type PgnEval, type SampleTimeClass } from "./pgn";
import type { SampleItem } from "./sampler";

/** P3's stored eval limits (codec.ts; the importer's EVAL_CP_LIMIT / EVAL_MATE_BASE). */
const CP_LIMIT = 9999;
const MATE_BASE = 30000;
/** LineV1.pv is at most 200 characters of whole moves (CA analysis.ts LINE_PV_MAX). */
const LINE_PV_MAX = 200;

/** The engine's facts for one position (White POV, the worker's factsFromSearch). */
export interface PositionFacts {
  eval: number;
  second: number;
  /** UCI of the best move, or null. */
  best: string | null;
  /** The first line's PV (UCI). */
  pv: string[];
}

/** One position the engine must search: the worker's search start (last irreversible position + the plies since). */
export interface SearchNeed {
  index: number;
  fen: string;
  moves: string[];
}

export interface PreparedSide {
  item: SampleItem;
  replay: Replay;
  game: SideInputsGame & { incrementSeconds: number; timeClass: SampleTimeClass };
  /** The hinted pass-1 arrays (position 0 from the engine's start facts). */
  evals: number[];
  second: number[];
  best: number[];
  judgements: number[];
  middlegamePly: number | null;
  endgamePly: number | null;
  accuracy: number | null;
  phaseAccuracy: [number, number, number];
  result: "WIN" | "LOSS" | "DRAW";
  /** Ply offsets of the side's MISTAKE / BLUNDER / MISS plies. */
  errors: number[];
  /** Positions to search (deduplicated, ascending). */
  needs: SearchNeed[];
  /** Terminal value per position (null = searchable). */
  terminal: (number | null)[];
}

/** What --grade journals per side. */
export interface SideRecord {
  v: 1;
  key: string;
  id: string;
  color: Color;
  elo: number;
  result: "WIN" | "LOSS" | "DRAW";
  plies: number;
  accuracy: number | null;
  phaseAccuracy: [number, number, number];
  inputs: SideInputs;
  searches: number;
}

export type Prepared = { ok: true; side: PreparedSide } | { ok: false; reason: string };

/** The importer's eval hint value of one %eval. */
export function hintValue(e: PgnEval): number {
  if ("mate" in e) return (e.mate > 0 ? 1 : -1) * (MATE_BASE - Math.abs(e.mate));
  return Math.max(-CP_LIMIT, Math.min(CP_LIMIT, e.cp));
}

/** Per position, the search start the worker uses (WK pipeline/positions.ts planPositions) and the terminal value. */
export function positionPlan(replay: Replay): { terminal: (number | null)[]; searchFen: string[]; searchMoves: string[][] } {
  const n = replay.uci.length;
  const terminal: (number | null)[] = [];
  const searchFen: string[] = [];
  const searchMoves: string[][] = [];
  let lastIrreversible = 0;
  for (let i = 0; i <= n; i++) {
    const fen = replay.fens[i] as string;
    const half = Number(fen.trim().split(/\s+/)[4] ?? "0");
    if (i > 0 && half === 0) lastIrreversible = i;
    let t: number | null = null;
    if (i === n) {
      if (replay.final.checkmate) t = encodeMate(moverAt(n - 1, replay.startMover), 0);
      else if (replay.final.draw || replay.final.stalemate) t = 0;
    }
    terminal.push(t);
    searchFen.push(replay.fens[lastIrreversible] as string);
    searchMoves.push(replay.uci.slice(lastIrreversible, i));
  }
  return { terminal, searchFen, searchMoves };
}

/** The engine's facts from a search result (the worker's factsFromSearch: MultiPV 1 = the eval, 2 = `second`). */
export function factsOf(result: { bestmove: string | null; lines: { multipv: number; score: { cp: number } | { mate: number }; pv: string[] }[] }, mover: Color): PositionFacts {
  const lines = [...result.lines].sort((a, b) => a.multipv - b.multipv);
  const first = lines[0];
  if (!first) throw new Error("the engine returned no line for a position with legal moves");
  return {
    eval: fromEngineScore(first.score, mover),
    second: lines[1] ? fromEngineScore(lines[1].score, mover) : NO_SECOND,
    best: result.bestmove ?? first.pv[0] ?? null,
    pv: first.pv,
  };
}

function resultOf(header: string | undefined, color: Color): "WIN" | "LOSS" | "DRAW" | null {
  if (header === "1/2-1/2") return "DRAW";
  if (header === "1-0") return color === "w" ? "WIN" : "LOSS";
  if (header === "0-1") return color === "b" ? "WIN" : "LOSS";
  return null;
}

const MEMBER_RESULT = { WIN: "win", LOSS: "loss", DRAW: "draw" } as const;

/** Grades the side from its %eval record (see the header). `start` = our engine's facts for position 0. */
export function prepareSide(item: SampleItem, start: PositionFacts, book: BookSet): Prepared {
  const parsed = parseMovetext(item.movetext);
  const clock = clockOf(item.headers.TimeControl ?? "");
  const result = resultOf(item.headers.Result, item.color);
  if (!clock || !result) return { ok: false, reason: "headers" };
  let replay: Replay;
  try {
    replay = replaySan(INITIAL_FEN, parsed.sans);
  } catch {
    return { ok: false, reason: "illegal_move" };
  }
  const n = replay.uci.length;
  const plan = positionPlan(replay);
  // The eval hint (the importer's evalHintOf): one per ply, or one short when the game ends in mate.
  const cp: number[] = [];
  for (const e of parsed.evals) if (e) cp.push(hintValue(e));
  if (cp.length === n - 1 && replay.final.checkmate) cp.push((moverAt(n - 1, replay.startMover) === "w" ? 1 : -1) * MATE_BASE);
  if (cp.length !== n) return { ok: false, reason: "eval_gaps" };
  // hintedPass1: position 0 searched, 1…n from the hint unless terminal; second / best unknown.
  const evals = [start.eval];
  const second = [start.second];
  const best = [start.best ? encodeMove(start.best) : MOVE_UNKNOWN];
  for (let i = 1; i <= n; i++) {
    evals.push(plan.terminal[i] ?? (cp[i - 1] as number));
    second.push(NO_SECOND);
    best.push(MOVE_UNKNOWN);
  }
  const clocks = parsed.clocksSec.map((s) => Math.round((s as number) * 1000));
  const graded = gradeAnalysis({
    startFen: INITIAL_FEN,
    startPly: 0,
    moves: replay.uci,
    evals,
    second,
    best,
    isBook: (epd) => book.has(epd),
    members: [{ side: item.color, result: MEMBER_RESULT[result] }],
  });
  const errors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (moverAt(i, replay.startMover) === item.color && errorJudgementOf(graded.judgements[i] as number) !== null) errors.push(i);
  }
  const wanted = new Set<number>();
  for (const i of errors) {
    wanted.add(i);
    if (i + 1 <= n && plan.terminal[i + 1] === null) wanted.add(i + 1);
  }
  const needs = [...wanted].sort((a, b) => a - b).map((index) => ({ index, fen: plan.searchFen[index] as string, moves: plan.searchMoves[index] as string[] }));
  return {
    ok: true,
    side: {
      item,
      replay,
      game: {
        startingFen: INITIAL_FEN,
        startPly: 0,
        moves: replay.uci,
        moveClocksMs: clocks,
        initialTimeSeconds: clock.initialSeconds,
        incrementSeconds: clock.incrementSeconds,
        timeClass: item.tc,
      },
      evals,
      second,
      best,
      judgements: graded.judgements,
      middlegamePly: graded.division.middlegamePly,
      endgamePly: graded.division.endgamePly,
      accuracy: graded.accuracy[item.color],
      phaseAccuracy: graded.phaseAccuracy[item.color],
      result,
      errors,
      needs,
      terminal: plan.terminal,
    },
  };
}

/** The stored-line text of a PV (whole moves, at most 200 characters: CA analysis.ts pvText). */
export function pvText(pv: readonly string[]): string {
  let s = "";
  for (const m of pv) {
    const next = s === "" ? m : `${s} ${m}`;
    if (next.length > LINE_PV_MAX) break;
    s = next;
  }
  return s;
}

/** The side's five `game_players` inputs from the engine's answers (see the header). */
export function finishSide(p: PreparedSide, facts: ReadonlyMap<number, PositionFacts>): SideRecord {
  const best = [...p.best];
  const lines: Record<string, { pv: string }> = {};
  for (const need of p.needs) {
    const f = facts.get(need.index);
    if (!f) throw new Error(`side ${p.item.id}:${p.item.color}: no engine facts for position ${need.index}`);
    best[need.index] = f.best ? encodeMove(f.best) : MOVE_UNKNOWN;
  }
  for (const i of p.errors) {
    const pv = facts.get(i)?.pv ?? [];
    if (pv.length > 0) lines[String(i)] = { pv: pvText(pv) };
  }
  const analysis: SideInputsAnalysis = {
    evals: p.evals,
    best,
    judgements: p.judgements,
    lines,
    middlegamePly: p.middlegamePly,
    endgamePly: p.endgamePly,
  };
  const inputs = computeSideInputs(p.game, analysis, { color: p.item.color, result: p.result }, { replay: p.replay });
  return {
    v: 1,
    key: `${p.item.band}:${p.item.tc}`,
    id: p.item.id,
    color: p.item.color,
    elo: p.item.elo,
    result: p.result,
    plies: p.replay.uci.length,
    accuracy: p.accuracy,
    phaseAccuracy: p.phaseAccuracy,
    inputs,
    searches: p.needs.length,
  };
}

/** Judgement counts of one side (moves = graded plies, as STATS_V1 counts them). */
export interface JudgementCounts {
  moves: number;
  MISTAKE: number;
  BLUNDER: number;
  MISS: number;
}

export function judgementCounts(judgements: readonly number[], color: Color, startMover: Color): JudgementCounts {
  const c: JudgementCounts = { moves: 0, MISTAKE: 0, BLUNDER: 0, MISS: 0 };
  judgements.forEach((code, i) => {
    if (moverAt(i, startMover) !== color || code === J.BOOK || code === J.FORCED || code === J.UNGRADED) return;
    c.moves++;
    if (code === J.MISTAKE) c.MISTAKE++;
    else if (code === J.BLUNDER) c.BLUNDER++;
    else if (code === J.MISS) c.MISS++;
  });
  return c;
}

/** What --calibrate journals per side: the same side graded from %eval and from our engine on every position. */
export interface CalibrationRecord {
  v: 1;
  key: string;
  id: string;
  color: Color;
  eval: JudgementCounts;
  engine: JudgementCounts;
  searches: number;
}

/** Every position our engine must search for the full grading of a prepared side (non-terminal ones). */
export function calibrationNeeds(p: PreparedSide): SearchNeed[] {
  const plan = positionPlan(p.replay);
  const out: SearchNeed[] = [];
  for (let i = 0; i <= p.replay.uci.length; i++) {
    if (plan.terminal[i] !== null) continue;
    out.push({ index: i, fen: plan.searchFen[i] as string, moves: plan.searchMoves[i] as string[] });
  }
  return out;
}

/** The side graded with our engine's pass 1 on every position (the worker's ENGINE path without pass 2). */
export function calibrationRecord(p: PreparedSide, facts: ReadonlyMap<number, PositionFacts>, book: BookSet): CalibrationRecord {
  const n = p.replay.uci.length;
  const evals: number[] = [];
  const second: number[] = [];
  const best: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = p.terminal[i];
    if (t !== null && t !== undefined) {
      evals.push(t);
      second.push(NO_SECOND);
      best.push(MOVE_UNKNOWN);
      continue;
    }
    const f = facts.get(i);
    if (!f) throw new Error(`side ${p.item.id}:${p.item.color}: no engine facts for position ${i}`);
    evals.push(f.eval);
    second.push(f.second);
    best.push(f.best ? encodeMove(f.best) : MOVE_UNKNOWN);
  }
  const graded = gradeAnalysis({
    startFen: INITIAL_FEN,
    startPly: 0,
    moves: p.replay.uci,
    evals,
    second,
    best,
    isBook: (epd) => book.has(epd),
    members: [{ side: p.item.color, result: MEMBER_RESULT[p.result] }],
  });
  return {
    v: 1,
    key: `${p.item.band}:${p.item.tc}`,
    id: p.item.id,
    color: p.item.color,
    eval: judgementCounts(p.judgements, p.item.color, p.replay.startMover),
    engine: judgementCounts(graded.judgements, p.item.color, p.replay.startMover),
    searches: facts.size,
  };
}
