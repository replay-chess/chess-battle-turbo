// Which plies of a game side become Mistake Bank items (phase-05 plan §8.1 step 1; owner decisions D-1 and D-9).
//
// Candidates are the member side's own plies i where
//   - the judgement is MISTAKE, BLUNDER or MISS, or an INACCURACY that lost ≥ BANK_INACCURACY_MIN_LOSS (7) Win% in an
//     undecided position (10 ≤ Win% before ≤ 90) — D-1;
//   - the ply is not BOOK, not one of the first BANK_SKIP_FIRST_PLIES (6) plies of the game (absolute ply
//     `startPly + i`, so a game started from a legend position keeps its early plies), and the best move of the
//     position is known (it is the answer the drill teaches);
//   - the game is not flagged `meta.colorUnknown` (a legacy game whose sides cannot be trusted: nothing is extracted).
// They are ranked by the Win% loss (ties: MISS > BLUNDER > MISTAKE > INACCURACY, then the earlier ply) and at most
// MAX_BANK_PER_GAME (4) are kept per game side. Every key-moment ply of the side (P3's moments, ≤ 3, always errors)
// is forced into the set first, so the bank and the review never disagree; the remaining places go to the ranked
// candidates. Only moment plies get a card (D-9); the others are `Mistake` rows for statistics and later phases.
//
// `source` is MISSED_PUNISH for a MISS (the member failed to punish the opponent's error at i − 1), else OWN_ERROR.
//
// Pure: runs on the stored per-ply arrays (judgement codes and evals), so the live analysis (J1) and the
// EXTRACT_MISTAKES backfill select the same plies from the same game.

import { evalFor, J, moverAt, type Color, type JudgementCode } from "../codec";
import { winPct } from "../winpct";

/** At most this many `Mistake` rows per game side. */
export const MAX_BANK_PER_GAME = 4;
/** D-1: an inaccuracy enters the bank from this Win% loss … */
export const BANK_INACCURACY_MIN_LOSS = 7;
/** … in an undecided position: LOW ≤ Win% before ≤ HIGH. */
export const BANK_UNDECIDED = { LOW: 10, HIGH: 90 } as const;
/** The first plies of a game (absolute ply number) are never candidates. */
export const BANK_SKIP_FIRST_PLIES = 6;

const PRIMARY: ReadonlySet<number> = new Set([J.MISTAKE, J.BLUNDER, J.MISS]);
const SEVERITY: Readonly<Partial<Record<number, number>>> = {
  [J.MISS]: 4,
  [J.BLUNDER]: 3,
  [J.MISTAKE]: 2,
  [J.INACCURACY]: 1,
};

export type MistakeSourceDb = "OWN_ERROR" | "MISSED_PUNISH";

export interface BankCandidate {
  ply: number;
  code: JudgementCode;
  /** Win% loss (mover POV). */
  loss: number;
  /** Mover's Win% before the move (= after the best move) and after the played move. */
  winBefore: number;
  winAfter: number;
  source: MistakeSourceDb;
  /** A P3 key moment of this side: the ply gets a BANK card (unless opted out or hidden). */
  moment: boolean;
}

export interface CandidateInput {
  /** JudgementCode per ply (game_analyses.judgements). */
  judgements: readonly number[];
  /** Stored evals of positions 0 … n (White POV). */
  evals: readonly number[];
  side: Color;
  startMover: Color;
  /** games."startPly": absolute ply of the start position. */
  startPly: number;
  /** The side's key-moment plies (PlayerReview.content.moments[*].ply). */
  momentPlies: readonly number[];
  /** games.meta.colorUnknown (legacy games). */
  colorUnknown?: boolean;
  /** Whether the best move of a position is known (default: every position). */
  hasBest?: (ply: number) => boolean;
}

function rank(a: BankCandidate, b: BankCandidate): number {
  if (b.loss !== a.loss) return b.loss - a.loss;
  const s = (SEVERITY[b.code] ?? 0) - (SEVERITY[a.code] ?? 0);
  return s !== 0 ? s : a.ply - b.ply;
}

function candidateAt(input: CandidateInput, ply: number, moment: boolean): BankCandidate | null {
  const code = input.judgements[ply];
  const before = input.evals[ply];
  const after = input.evals[ply + 1];
  if (code === undefined || before === undefined || after === undefined) return null;
  if (moverAt(ply, input.startMover) !== input.side) return null;
  if (input.hasBest && !input.hasBest(ply)) return null;
  const winBefore = winPct(evalFor(before, input.side));
  const winAfter = winPct(evalFor(after, input.side));
  const loss = Math.max(0, winBefore - winAfter);
  return {
    ply,
    code: code as JudgementCode,
    loss,
    winBefore,
    winAfter,
    source: code === J.MISS ? "MISSED_PUNISH" : "OWN_ERROR",
    moment,
  };
}

/** Does a ply qualify on its own (rules of the header, without the key-moment union)? */
export function qualifies(input: CandidateInput, c: BankCandidate): boolean {
  if (c.code === J.BOOK) return false;
  if (input.startPly + c.ply < BANK_SKIP_FIRST_PLIES) return false;
  if (PRIMARY.has(c.code)) return true;
  return (
    c.code === J.INACCURACY &&
    c.loss >= BANK_INACCURACY_MIN_LOSS &&
    c.winBefore >= BANK_UNDECIDED.LOW &&
    c.winBefore <= BANK_UNDECIDED.HIGH
  );
}

/** The side's bank candidates: the key moments, then the ranked qualifying plies, ≤ 4, in ply order. */
export function selectCandidates(input: CandidateInput): BankCandidate[] {
  if (input.colorUnknown) return [];
  const n = input.judgements.length;
  const moments = new Set(input.momentPlies.filter((p) => Number.isInteger(p) && p >= 0 && p < n));
  const picked: BankCandidate[] = [];
  for (const ply of [...moments].sort((a, b) => a - b)) {
    const c = candidateAt(input, ply, true);
    // A moment is always an error (P3's rules); a non-error moment (a stale review) is not a bank item.
    if (c && c.code >= J.INACCURACY && c.code <= J.BLUNDER) picked.push(c);
  }
  const rest: BankCandidate[] = [];
  for (let ply = 0; ply < n; ply++) {
    if (moments.has(ply)) continue;
    const c = candidateAt(input, ply, false);
    if (c && qualifies(input, c)) rest.push(c);
  }
  rest.sort(rank);
  for (const c of rest) {
    if (picked.length >= MAX_BANK_PER_GAME) break;
    picked.push(c);
  }
  return picked.slice(0, MAX_BANK_PER_GAME).sort((a, b) => a.ply - b.ply);
}
