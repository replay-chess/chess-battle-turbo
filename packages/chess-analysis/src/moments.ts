// Key moments, the clean game and the best decision (phase-03 plan §8.5, §8.6; P3-D14).
//
// Candidates are the member's own plies:
//   primary  BLUNDER, MISS, MISTAKE
//   fill     INACCURACY with a Win% loss d ≥ FILL_MIN_LOSS (7), used only while fewer than MAX_MOMENTS are picked
//   skipped  decided positions: (Wb < 10 and Wa < 10) or (Wb > 90 and Wa > 90)
// Ranking: d descending, then MISS > BLUNDER > MISTAKE > INACCURACY, then the earlier ply. Picking is greedy over the
// ranked primaries, then the ranked fills, and rejects a candidate within MIN_SPACING (3) plies of one already
// picked. The result is ordered by ply (walkthrough order).
//
// For the design fixture `GAME` this picks plies 32 (INACCURACY, d 9.9, fill), 36 (MISS, d 30.1) and 40 (BLUNDER,
// d 23.3): the design's three moments.
//
// A candidate needs a known best move to be taught (the ask/reveal flow shows it), so a ply whose best move is
// unknown (Lichess-eval imports without `best`) is not a candidate. The review builder passes `hasBest`.
//
// Clean game: no candidate at all, primary or fill. Best ply: the member's first BRILLIANT, else the first GREAT,
// else the member ply with the largest Win% gain over the position before it, among plies that were a choice (not
// BOOK, not FORCED) and that gained (> 0). With no such ply there is no best decision.
//
// Pass 2 (§8.12 step 7) refines the picked moments: `trimPv` cuts the principal variation to 3–8 plies, stopping
// after the first capture sequence ends, and `acceptMoves` lists every MultiPV-3 move within ACCEPT_WITHIN (2) Win%
// of the best (the user "found" the move iff it is in that list). `pass2Candidates` tells the worker which positions
// deserve the 1M-node search (at most ENGINE_PROFILE.pass2.maxPositions per game).

import type { PlyGrade } from "./classify";
import { BRILLIANT_RULE } from "./classify";
import { evalFor, J, moverAt, type Color, type JudgementCode } from "./codec";
import { exchangeGain, playLine } from "./text/facts";
import { ENGINE_PROFILE } from "./version";
import { winPct } from "./winpct";

export const MAX_MOMENTS = 3;
export const FILL_MIN_LOSS = 7;
export const MIN_SPACING = 3;
export const ACCEPT_WITHIN = 2;
/** Decided positions are skipped: both Win% values below LOW, or both above HIGH. */
export const DECIDED = { LOW: 10, HIGH: 90 } as const;
/** A moment's line holds 3 to 8 plies (fewer only when the game or a mate ends it). */
export const PV_MIN_PLIES = 3;
export const PV_MAX_PLIES = 8;

const PRIMARY: ReadonlySet<number> = new Set([J.BLUNDER, J.MISS, J.MISTAKE]);
const SEVERITY_RANK: Readonly<Partial<Record<number, number>>> = {
  [J.MISS]: 4,
  [J.BLUNDER]: 3,
  [J.MISTAKE]: 2,
  [J.INACCURACY]: 1,
};

export interface MomentPick {
  ply: number;
  code: JudgementCode;
  /** Win% loss d (mover POV). */
  loss: number;
  winBefore: number;
  winAfter: number;
  /** True for an INACCURACY taken as a fill. */
  fill: boolean;
}

function isDecided(g: PlyGrade): boolean {
  return (
    (g.winBefore < DECIDED.LOW && g.winAfter < DECIDED.LOW) || (g.winBefore > DECIDED.HIGH && g.winAfter > DECIDED.HIGH)
  );
}

function rankCompare(a: MomentPick, b: MomentPick): number {
  if (b.loss !== a.loss) return b.loss - a.loss;
  const r = (SEVERITY_RANK[b.code] ?? 0) - (SEVERITY_RANK[a.code] ?? 0);
  return r !== 0 ? r : a.ply - b.ply;
}

export interface MomentOptions {
  /** Whether the best move of a ply is known (default: every ply). */
  hasBest?: (ply: number) => boolean;
}

/** Every candidate of `side` (primary and fill), ranked. Empty for a clean game. */
export function momentCandidates(
  grades: readonly PlyGrade[],
  side: Color,
  startMover: Color,
  opts: MomentOptions = {},
): MomentPick[] {
  const out: MomentPick[] = [];
  for (const g of grades) {
    if (moverAt(g.ply, startMover) !== side || isDecided(g)) continue;
    if (opts.hasBest && !opts.hasBest(g.ply)) continue;
    const primary = PRIMARY.has(g.code);
    const fill = g.code === J.INACCURACY && g.loss >= FILL_MIN_LOSS;
    if (!primary && !fill) continue;
    out.push({ ply: g.ply, code: g.code, loss: g.loss, winBefore: g.winBefore, winAfter: g.winAfter, fill: !primary });
  }
  return out.sort(rankCompare);
}

/** The key moments of `side`: ≤ MAX_MOMENTS, spaced, in ply order. */
export function pickMoments(
  grades: readonly PlyGrade[],
  side: Color,
  startMover: Color,
  opts: MomentOptions = {},
): MomentPick[] {
  const ranked = momentCandidates(grades, side, startMover, opts);
  const picked: MomentPick[] = [];
  const take = (pool: MomentPick[]) => {
    for (const c of pool) {
      if (picked.length >= MAX_MOMENTS) return;
      if (picked.some((p) => Math.abs(p.ply - c.ply) <= MIN_SPACING)) continue;
      picked.push(c);
    }
  };
  take(ranked.filter((c) => !c.fill));
  take(ranked.filter((c) => c.fill));
  return picked.sort((a, b) => a.ply - b.ply);
}

/** No candidate at all (primary or fill) for `side`. */
export function isCleanGame(
  grades: readonly PlyGrade[],
  side: Color,
  startMover: Color,
  opts: MomentOptions = {},
): boolean {
  return momentCandidates(grades, side, startMover, opts).length === 0;
}

/**
 * The moment the game turned on: the picked primary moment with the largest loss (ties: MISS > BLUNDER > MISTAKE,
 * then the earlier ply); a fill moment only when there is no primary one. Null without moments.
 */
export function worstMoment(moments: readonly MomentPick[]): MomentPick | null {
  const primary = moments.filter((m) => !m.fill).sort(rankCompare);
  if (primary[0]) return primary[0];
  return moments.slice().sort(rankCompare)[0] ?? null;
}

/** The member's best decision (§8.6), or null. */
export function bestPly(grades: readonly PlyGrade[], side: Color, startMover: Color): number | null {
  const own = grades.filter((g) => moverAt(g.ply, startMover) === side);
  const brilliant = own.find((g) => g.code === J.BRILLIANT);
  if (brilliant) return brilliant.ply;
  const great = own.find((g) => g.code === J.GREAT);
  if (great) return great.ply;
  let best: PlyGrade | null = null;
  for (const g of own) {
    if (g.code === J.BOOK || g.code === J.FORCED) continue;
    const gain = g.winAfter - g.winBefore;
    if (gain <= 0) continue;
    if (!best || gain > best.winAfter - best.winBefore) best = g;
  }
  return best?.ply ?? null;
}

/**
 * The legal prefix of a principal variation, cut to PV_MIN_PLIES … PV_MAX_PLIES: it ends after the first capture
 * sequence ends (the first quiet ply after a run of captures), and never runs past PV_MAX_PLIES. A line that ends
 * sooner (mate, or the engine's PV is short) is kept whole.
 */
export function trimPv(fenBefore: string, pv: readonly string[]): string[] {
  const moves = playLine(fenBefore, pv.slice(0, PV_MAX_PLIES));
  let cut = moves.length;
  let inCaptures = false;
  for (let k = 0; k < moves.length; k++) {
    const m = moves[k]!;
    if (m.captured || m.isEnPassant()) inCaptures = true;
    else if (inCaptures) {
      cut = k;
      break;
    }
  }
  cut = Math.max(Math.min(PV_MIN_PLIES, moves.length), Math.min(cut, PV_MAX_PLIES));
  return moves.slice(0, cut).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`);
}

/** One MultiPV line of a pass-2 search: its first move and its score (stored encoding, White POV). */
export interface MultiPvLine {
  uci: string;
  eval: number;
}

/**
 * The moves within ACCEPT_WITHIN Win% of the best (mover POV), best first, at most 3 (MultiPV 3). `lines` is the
 * engine's MultiPV output in its own order (line 1 = the best).
 */
export function acceptMoves(lines: readonly MultiPvLine[], mover: Color): string[] {
  if (lines.length === 0) return [];
  const scored = lines.map((l) => ({ uci: l.uci, w: winPct(evalFor(l.eval, mover)) }));
  const top = scored[0]!.w;
  const out: string[] = [];
  for (const s of scored) {
    if (out.length >= 3) break;
    if (top - s.w <= ACCEPT_WITHIN && !out.includes(s.uci)) out.push(s.uci);
  }
  return out;
}

export interface Pass2CandidateInput {
  grades: readonly PlyGrade[];
  /** The member sides of the game. */
  members: readonly Color[];
  startMover: Color;
  /** FEN before each ply (Replay.fens). */
  fens: readonly string[];
  /** UCI per ply (Replay.uci). */
  uci: readonly string[];
  hasBest?: (ply: number) => boolean;
  /** Positions already promised to other work (the legend divergence evals take 2). */
  reserve?: number;
}

/**
 * Plies whose position (before the ply) gets the pass-2 search, in priority order, at most
 * ENGINE_PROFILE.pass2.maxPositions − reserve: each member side's picked moments (by rank), then the member's
 * BRILLIANT candidates (a ply that loses at most 2 Win%, keeps Wa ≥ 50, and puts material en prise: the played move
 * loses material on its own square, or the grader already called it BRILLIANT).
 */
export function pass2Candidates(input: Pass2CandidateInput): number[] {
  const limit = Math.max(0, ENGINE_PROFILE.pass2.maxPositions - (input.reserve ?? 0));
  const out: number[] = [];
  const push = (ply: number) => {
    if (out.length < limit && !out.includes(ply)) out.push(ply);
  };
  const perSide = input.members.map((side) =>
    pickMoments(input.grades, side, input.startMover, input.hasBest ? { hasBest: input.hasBest } : {})
      .slice()
      .sort(rankCompare),
  );
  // Interleave the sides so a two-member game gives both reviews their worst moments first.
  for (let k = 0; k < MAX_MOMENTS; k++) for (const list of perSide) if (list[k]) push(list[k]!.ply);
  for (const g of input.grades) {
    if (!input.members.includes(moverAt(g.ply, input.startMover))) continue;
    if (g.code === J.BOOK || g.code === J.FORCED) continue;
    if (g.loss > BRILLIANT_RULE.MAX_LOSS || g.winAfter < BRILLIANT_RULE.MIN_WIN_AFTER) continue;
    const fen = input.fens[g.ply];
    const played = input.uci[g.ply];
    if (!fen || !played) continue;
    if (g.code === J.BRILLIANT || (exchangeGain(fen, played) ?? 0) < 0) push(g.ply);
  }
  return out;
}
