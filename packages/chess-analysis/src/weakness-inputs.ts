// The per-side weakness inputs of one analysed game (phase-06 plan §8.3.2, §6.4): STATS_V1, ERROR_LOG_V1, and the theme
// occurrences of every error (`errorThemes` + `errorThemeN`). CPU only: no engine, no I/O.
//
// Four call sites share this one function so their outputs can never differ (weakness-inputs.test.ts pins them to the
// same fixture output): the worker's final analysis batch, the B-W1 backfill (apps/web/scripts/backfill/
// backfill-weakness-inputs.ts), the weakness job's heal of rows with `weaknessInputsV = 0`, and the J5 baseline build.
//
// Inputs are the stored rows: the `games` columns (moves as UCI from startingFen, clocks, time class), the
// `game_analyses` arrays (evals per position, best MoveCode and JudgementCode per ply, LinesV1, the Divider plies as
// offsets from startPly), the member's colour and result. Ply indexes are offsets from `games."startPly"`, the index
// base of every array (codec.ts §8.1).
//
// 1. Replay the moves from startingFen (chess.js, replay.ts) for the FEN before each ply and the moved piece.
// 2. Each ply of the side adds to the STATS_V1 counters (BOOK, FORCED and ungraded plies are not "moves"), by phase
//    (Divider), clock bucket before the move (clock.ts; unknown clocks count in no bucket) and moved piece.
// 3. Errors are the side's MISTAKE, BLUNDER and MISS plies, in ply order. Each appends its ERROR_LOG_V1 code (Win% loss
//    from the mover's side, clock bucket, phase, judgement) and its themes from `tagErrorPly` (the P5 tagger, without
//    meta, phase and `mate` tags, at most 8): best line = the stored pass-2 PV of the ply, else the pass-1 PV the
//    worker searched for it (`opts.pass1Pv`, FIX-1: the J5 baseline tags every error from a full pass-1 PV, so a member
//    error must not be tagged from its best move alone), else its best move; the
//    refutation = the best move of the next position (the opponent's best reply to the played move), as the Mistake
//    Bank reads it (TRN extract.ts `bestAt`).
// 4. `rc:timePressure` is never stored here: it is derived from clock bucket lt1 in the log (plan §8.5).

import { pvText } from "./analysis";
import { isInitialPosition, placement } from "./board";
import { clockBucketBefore, type ClockGame } from "./clock";
import {
  J,
  STATS_V1_REACHED_CP,
  decodeMove,
  emptyStatsV1,
  encodeErrorLog,
  encodeStatsV1,
  errorJudgementOf,
  evalFor,
  moverAt,
  squareIndex,
  type Color,
  type ErrorLogClock,
  type WeaknessPhase,
} from "./codec";
import { plyLoss } from "./classify";
import { replayUci, type Replay } from "./replay";
import { ERROR_THEMES_MAX, tagErrorPly, type ErrorPlyInput } from "./themes/index";
import { winPct } from "./winpct";

/** `game_players."weaknessInputsV"` of rows these functions wrote: STATS_V1 + ERROR_LOG_V1 + ordered errorThemes. */
export const WEAKNESS_INPUTS_VERSION = 1;

/** The `games` columns the inputs read. */
export interface SideInputsGame extends ClockGame {
  startingFen: string;
  /** games."startPly" (absolute ply of startingFen). */
  startPly: number;
  /** games."moves": UCI from startingFen, space-separated (the stored text) or already split. */
  moves: string | readonly string[];
}

/** One `game_analyses.lines` entry (LinesV1); only `pv` is read. */
export interface SideInputsLine {
  pv: string;
}

/** The `game_analyses` columns the inputs read (a finished analysis: evals for positions 0…n, judgements 0…n−1). */
export interface SideInputsAnalysis {
  evals: readonly number[];
  best: readonly number[];
  judgements: readonly number[];
  lines: Readonly<Record<string, SideInputsLine>> | null;
  /** Ply offsets from startPly where the middlegame / endgame starts (Divider); null = not reached. */
  middlegamePly: number | null;
  endgamePly: number | null;
}

export interface SideInputsSide {
  color: Color;
  /** game_players.result (PlayerResult enum name). */
  result: "WIN" | "LOSS" | "DRAW" | "ABORTED" | null;
}

export interface SideInputsOptions {
  /** The theme tagger (tests and the baseline may pass another); default `tagErrorPly`. */
  tagger?: (input: ErrorPlyInput) => readonly string[];
  /** The replay of `game.moves` from `game.startingFen` when the caller has one (the worker's pipeline does). */
  replay?: Replay;
  /**
   * The pass-1 principal variation (UCI) of position `ply`, when the caller searched one (the worker's analysis does,
   * for every error ply of a member side). Used when no pass-2 line is stored for the ply: multi-move motifs (forks,
   * pins, discovered attacks, sacrifices, mates in 2–3) need the line, and the baseline (J5) tags from a full PV.
   */
  pass1Pv?: (ply: number) => readonly string[] | null | undefined;
  /**
   * FIX-2 (D-P6-FIX2-4, D-P6-FIX2-8): counts what the tagging lacked, for the caller. `partial` += 1 for each error ply
   * tagged without a full line (no stored line, no pass-1 PV: the best move alone) or without the opponent's best
   * reply to it (the refutation `rc:missedThreat` and `rc:pawnStructure` read) while the game goes on after it.
   */
  report?: { partial: number };
}

/** What the five `game_players` columns store (weaknessInputsV = WEAKNESS_INPUTS_VERSION). */
export interface SideInputs {
  /** STATS_V1, 30 smallints. */
  stats: number[];
  /** ERROR_LOG_V1, one smallint per error in ply order. */
  errorLog: number[];
  /** For error i, how many consecutive errorThemes entries belong to it (0…8). */
  errorThemeN: number[];
  /** Theme keys of every error, in error order. */
  errorThemes: string[];
}

const PHASE_ENUM = { opening: "OPENING", middlegame: "MIDDLEGAME", endgame: "ENDGAME" } as const;
const PIECE_SLOT: Readonly<Record<string, number>> = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

/** Phase of ply offset `i` from the Divider plies (the Mistake Bank's rule, TRN extract.ts `phaseOf`). */
export function phaseOfPly(i: number, a: Pick<SideInputsAnalysis, "middlegamePly" | "endgamePly">): WeaknessPhase {
  if (a.endgamePly !== null && i >= a.endgamePly) return "endgame";
  if (a.middlegamePly !== null && i >= a.middlegamePly) return "middlegame";
  return "opening";
}

function movesOf(m: SideInputsGame["moves"]): string[] {
  if (typeof m !== "string") return [...m];
  const t = m.trim();
  return t === "" ? [] : t.split(/\s+/);
}

function pvOf(line: SideInputsLine | undefined): string[] {
  return line?.pv ? line.pv.split(" ").filter(Boolean) : [];
}

/** Best move of position `i`: the stored pass-2 line's first move, else the pass-1 best move (TRN extract `bestAt`). */
function bestAt(a: SideInputsAnalysis, i: number): string | null {
  return pvOf(a.lines?.[String(i)])[0] ?? decodeMove(a.best[i] ?? 0);
}

/** The moved piece of a ply, from the position before it. */
function movedPiece(fen: string, uci: string): number {
  const sq = squareIndex(uci.slice(0, 2));
  const piece = placement(fen)[sq];
  if (!piece) throw new RangeError(`no piece on ${uci.slice(0, 2)} in ${fen}`);
  return PIECE_SLOT[piece.type] as number;
}

function bump(counters: number[], i: number): void {
  counters[i] = (counters[i] ?? 0) + 1;
}

/** Computes the five columns' values for one member side (see the header). Throws on inconsistent rows. */
export function computeSideInputs(
  game: SideInputsGame,
  analysis: SideInputsAnalysis,
  side: SideInputsSide,
  opts: SideInputsOptions = {},
): SideInputs {
  const moves = movesOf(game.moves);
  const replay = opts.replay ?? replayUci(game.startingFen, moves);
  const n = replay.uci.length;
  if (n !== moves.length) throw new RangeError(`replay has ${n} plies, the game ${moves.length}`);
  if (analysis.evals.length !== n + 1) throw new RangeError(`expected ${n + 1} evals, got ${analysis.evals.length}`);
  if (analysis.judgements.length < n) throw new RangeError(`expected ${n} judgements, got ${analysis.judgements.length}`);
  const tagger = opts.tagger ?? tagErrorPly;
  const { color } = side;

  const s = emptyStatsV1();
  const errorLog: number[] = [];
  const errorThemeN: number[] = [];
  const errorThemes: string[] = [];
  let sawBook = false;
  let exitWin: number | null = null;
  let exitFound = false;

  for (let i = 0; i < n; i++) {
    if (moverAt(i, replay.startMover) !== color) continue;
    const code = analysis.judgements[i] as number;
    const evalAfter = analysis.evals[i + 1] as number;
    // Slot 27: this side reached +300 cp after one of its moves (a mate for the side counts).
    if (evalFor(evalAfter, color) >= STATS_V1_REACHED_CP) s.reachedPlus3 = true;
    // Slot 29: Win% after the side's first move out of book, when the side had book moves before it.
    if (!exitFound) {
      if (code === J.BOOK) sawBook = true;
      else {
        exitFound = true;
        if (sawBook) exitWin = Math.round(winPct(evalFor(evalAfter, color)));
      }
    }
    if (code === J.BOOK || code === J.FORCED || code === J.UNGRADED) continue;

    const phase = phaseOfPly(i, analysis);
    const ph = phase === "opening" ? 0 : phase === "middlegame" ? 1 : 2;
    const bucket = clockBucketBefore(game, i);
    const fenBefore = replay.fens[i] as string;
    const uci = replay.uci[i] as string;
    const piece = movedPiece(fenBefore, uci);
    s.moves++;
    bump(s.phaseMoves, ph);
    if (bucket > 0) bump(s.clockMoves, bucket - 1);
    bump(s.pieceMoves, piece);

    const judgement = errorJudgementOf(code);
    if (judgement === null) continue;
    bump(s.phaseErrors, ph);
    if (bucket > 0) bump(s.clockErrors, bucket - 1);
    bump(s.pieceErrors, piece);
    const loss = plyLoss(analysis.evals[i] as number, evalAfter, color);
    errorLog.push(encodeErrorLog({ judgement, phase: ph, clockBucket: bucket as ErrorLogClock, winLoss: Math.min(100, Math.round(loss)) }));

    const stored = pvOf(analysis.lines?.[String(i)]);
    // The pass-1 PV is cut as a stored line is (pvText), so a pass-1 line tags exactly as the baseline's stored one.
    const pass1 = stored.length > 0 ? null : opts.pass1Pv?.(i);
    const pv = stored.length > 0 ? stored : pass1 ? pvOf({ pv: pvText(pass1) }) : [];
    const best = decodeMove(analysis.best[i] ?? 0);
    const setupUci = i >= 1 ? (replay.uci[i - 1] as string) : null;
    // The refutation: the stored line or best move of position i + 1, else its pass-1 PV (FIX-2: an eval-hinted import
    // knows no best move past position 0; the worker searches i + 1 for each member error, as J5 does for the band).
    const refute = bestAt(analysis, i + 1) ?? opts.pass1Pv?.(i + 1)?.[0] ?? null;
    if (opts.report && (pv.length === 0 || (refute === null && i + 1 < n))) opts.report.partial += 1;
    const themes = tagger({
      fenBefore,
      bestLine: pv.length > 0 ? pv : best ? [best] : [],
      playedUci: uci,
      refuteUci: refute,
      evalBest: analysis.evals[i] as number,
      phase: PHASE_ENUM[phase],
      setupUci,
      setupCaptured: setupUci !== null && (replay.san[i - 1] ?? "").includes("x"),
    }).slice(0, ERROR_THEMES_MAX);
    errorThemeN.push(themes.length);
    errorThemes.push(...themes);
  }

  // A game from a set-up position has no book exit to measure.
  s.bookExitWin = isInitialPosition(game.startingFen) ? exitWin : null;
  s.converted = s.reachedPlus3 && side.result === "WIN";
  return { stats: encodeStatsV1(s), errorLog, errorThemeN, errorThemes };
}
