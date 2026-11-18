// Phase and clock breakdowns (phase-06 plan §8.7, §8.8) and the piece rates P7 reads (never rendered in P6). Pure.
import type { Aggregate, AnalysedGame } from "./aggregate";
import { type BandMix, bandValue } from "./band";
import { CLOCK_MIN_MOVES_BUCKET, CLOCK_MIN_MOVES_TOTAL, CLOCK_SENTENCE_FALL_RATIO, CLOCK_SENTENCE_MIN_RATIO, CLOCK_SENTENCE_RISE_RATIO, PHASE_MIN_MOVES, PHASE_MIN_MOVES_GAME, PHASE_SENTENCE_DELTA } from "./constants";
import { CLOCK_WORDS, round1 } from "./labels";
import type { ClockBucketDoc, PieceKey, WeaknessBreakdownDoc, WeaknessPhase } from "./types";
import { CLOCK_KEYS, PHASES, PIECES } from "./types";

export type PhaseRowDoc = WeaknessBreakdownDoc["phase"][number];

/**
 * you_p = round(Σ acc_{g,p}·m_{g,p} / Σ m_{g,p}) over games with acc ≥ 0 and m ≥ 3 (P3's per-phase accuracy,
 * R-ACC-02); null below 60 moves. band_p from the baseline's move-weighted phase accuracy.
 */
export function phaseBreakdown(games: readonly AnalysedGame[], mix: BandMix | null): PhaseRowDoc[] {
  return PHASES.map((phase, p) => {
    let num = 0;
    let den = 0;
    for (const { g, d } of games) {
      const acc = g.phaseAccuracy[p];
      const m = d.stats.phaseMoves[p]!;
      if (acc === undefined || acc < 0 || m < PHASE_MIN_MOVES_GAME) continue;
      num += acc * m;
      den += m;
    }
    const band = mix ? bandValue(mix, (c) => c.phaseAccuracy[p]!, null) : null;
    return { phase, you: den >= PHASE_MIN_MOVES ? Math.round(num / den) : null, band: band === null ? null : Math.round(band), moves: den };
  });
}

const ABOVE_NOUN: Readonly<Record<WeaknessPhase, string>> = { opening: "your openings", middlegame: "your middlegame", endgame: "your endgames" };
const PHASE_NOUN: Readonly<Record<WeaknessPhase, string>> = { opening: "opening", middlegame: "middlegame", endgame: "endgame" };

function joinAnd(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The phase sentence (§8.7): `above` = phases with you ≥ band + 2, `below` = you ≤ band − 2; the worst below has
 * the largest band − you. "Accuracy by phase. Your openings are above your band; the middlegame is where it drops."
 * A phase without a number (fewer than 60 moves) is never described: "the rest" and "every phase" are said only when
 * every phase has one (FIX-1, docs/decisions.md D-P6-FIX1-3).
 */
export function phaseSentence(rows: readonly PhaseRowDoc[]): string {
  const known = rows.filter((r): r is PhaseRowDoc & { you: number; band: number } => r.you !== null && r.band !== null);
  const head = "Accuracy by phase.";
  if (known.length === 0) return `${head} Not enough moves in each phase to compare yet.`;
  const allKnown = known.length === PHASES.length;
  const above = known.filter((r) => r.you >= r.band + PHASE_SENTENCE_DELTA);
  const below = known.filter((r) => r.you <= r.band - PHASE_SENTENCE_DELTA);
  const close = known.filter((r) => !above.includes(r) && !below.includes(r));
  const worst = [...below].sort((a, b) => b.band - b.you - (a.band - a.you) || PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase))[0];
  const verb = (rs: readonly PhaseRowDoc[]) => (rs.length > 1 || rs[0]!.phase !== "middlegame" ? "are" : "is");
  const nouns = (rs: readonly PhaseRowDoc[]) => joinAnd(rs.map((r) => ABOVE_NOUN[r.phase]));
  const aboveText = () => `${cap(nouns(above))} ${verb(above)} above your band`;
  if (allKnown && above.length === 3) return `${head} You are above your band in every phase.`;
  if (allKnown && below.length === 3) return `${head} Every phase is below your band; the ${PHASE_NOUN[worst!.phase]} drops most.`;
  if (above.length > 0 && below.length > 0) return `${head} ${aboveText()}; the ${PHASE_NOUN[worst!.phase]} is where it drops.`;
  if (above.length > 0) {
    if (close.length === 0) return `${head} ${aboveText()}.`;
    return allKnown ? `${head} ${aboveText()}; the rest is close to it.` : `${head} ${aboveText()}; ${nouns(close)} ${verb(close)} close to it.`;
  }
  if (below.length > 0) return `${head} The ${PHASE_NOUN[worst!.phase]} is where it drops below your band.`;
  return allKnown ? `${head} You are close to your band in every phase.` : `${head} ${cap(nouns(close))} ${verb(close)} close to your band.`;
}

/**
 * The clock section (§8.8): moves and blunders per bucket (the clock BEFORE the move), the rate from 30 moves in a
 * bucket, the whole section null below 100 timed moves (the Clock tab is hidden). The lt1 bucket and the
 * time-pressure row share numerator and denominator (copy note C4).
 */
export function clockBreakdown(a: Aggregate, mix: BandMix | null): { buckets: ClockBucketDoc[]; sentence: string } | null {
  const total = a.clockMoves.reduce((s, m) => s + m, 0);
  if (total < CLOCK_MIN_MOVES_TOTAL) return null;
  const buckets: ClockBucketDoc[] = CLOCK_KEYS.map((key, b) => {
    const moves = a.clockMoves[b]!;
    const blunders = a.clockBlunders[b]!;
    const band = mix ? bandValue(mix, (c) => c.clockBlunders100[b]!, "BLUNDER") : null;
    return {
      key,
      moves,
      blunders,
      per100: moves >= CLOCK_MIN_MOVES_BUCKET ? round1((100 * blunders) / moves) : null,
      band: band === null ? null : round1(band),
    };
  });
  return { buckets, sentence: clockSentence(a) };
}

/**
 * The clock sentence (§8.8, as corrected by FIX-1; docs/decisions.md D-P6-FIX1-2). It compares the blunder rate under
 * 2 minutes (1–2 and < 1 minute together) with the rate on the most comfortable clock that has a rate: over 5
 * minutes, or 2–5 minutes when the member rarely has 5 minutes (3+0, 3+2 and 5+0 blitz). Both need ≥ 30 moves.
 *   ratio ≥ 1.8 → "Below 2 minutes the rate doubles / triples / is N× higher."
 *   ratio ≥ 1.25 → "Below 2 minutes the rate rises."        ratio ≤ 0.8 → "Below 2 minutes the rate drops."
 *   otherwise → "Your blunder rate stays about the same as the clock runs down."
 *   no reference or no low-clock rate → "Not enough timed moves in each range to compare yet."
 * So the sentence never says "about the same" next to bars that rise or fall.
 */
/** The clock sentence's three rates (null below 30 moves): the comfortable reference, under 2 minutes, under 1 minute. */
export function clockRates(a: Pick<Aggregate, "clockMoves" | "clockBlunders">): { rRef: number | null; rLow: number | null; rLt1: number | null } {
  const rate = (moves: number, blunders: number) => (moves >= CLOCK_MIN_MOVES_BUCKET ? (100 * blunders) / moves : null);
  return {
    rRef: rate(a.clockMoves[0], a.clockBlunders[0]) ?? rate(a.clockMoves[1], a.clockBlunders[1]),
    rLow: rate(a.clockMoves[2] + a.clockMoves[3], a.clockBlunders[2] + a.clockBlunders[3]),
    rLt1: rate(a.clockMoves[3], a.clockBlunders[3]),
  };
}

/**
 * FIX-2 (D-P6-FIX2-6): the member blunders more as the clock runs down: the clock sentence says the rate rises (under
 * 2 minutes ≥ 1.25× the comfortable reference) and the rate under 1 minute is itself ≥ 1.25× the reference. The
 * time-pressure row and its headline exist only then, so they can never sit next to "Below 2 minutes the rate drops".
 */
export function clockRises(a: Pick<Aggregate, "clockMoves" | "clockBlunders">): boolean {
  const { rRef, rLow, rLt1 } = clockRates(a);
  if (rRef === null || rLow === null || rLt1 === null) return false;
  if (rRef === 0) return rLow > 0 && rLt1 > 0;
  return rLow >= CLOCK_SENTENCE_RISE_RATIO * rRef && rLt1 >= CLOCK_SENTENCE_RISE_RATIO * rRef;
}

export function clockSentence(a: Pick<Aggregate, "clockMoves" | "clockBlunders">): string {
  const head = "Blunders per 100 moves, by time left on your clock.";
  const { rRef, rLow } = clockRates(a);
  if (rRef === null || rLow === null) return `${head} Not enough timed moves in each range to compare yet.`;
  if (rRef === 0 && rLow === 0) return `${head} Your blunder rate stays about the same as the clock runs down.`;
  const x = rRef === 0 ? Number.POSITIVE_INFINITY : rLow / rRef;
  if (x >= CLOCK_SENTENCE_MIN_RATIO && Number.isFinite(x)) {
    const word = x < 2.5 ? "doubles" : x < 3.5 ? "triples" : `is ${Math.round(x)}× higher`;
    return `${head} Below 2 minutes the rate ${word}.`;
  }
  if (x >= CLOCK_SENTENCE_RISE_RATIO) return `${head} Below 2 minutes the rate rises.`;
  if (x <= CLOCK_SENTENCE_FALL_RATIO) return `${head} Below 2 minutes the rate drops.`;
  return `${head} Your blunder rate stays about the same as the clock runs down.`;
}

/** The chart's accessible name: every value in one sentence (TE P6 a11y). */
export function clockAriaLabel(buckets: readonly Pick<ClockBucketDoc, "key" | "per100">[]): string {
  const parts = buckets.map((b) => `${CLOCK_WORDS[b.key]} ${b.per100 === null ? "not enough moves" : b.per100.toFixed(1)}`);
  return `Blunders per 100 moves: ${parts.join(", ")}`;
}

/** Errors per 100 moves by the moved piece (P7 context only; null below 30 moves). */
export function pieceBreakdown(a: Aggregate): Array<{ piece: PieceKey; per100: number | null }> {
  return PIECES.map((piece, i) => {
    const moves = a.pieceMoves[i]!;
    return { piece, per100: moves >= CLOCK_MIN_MOVES_BUCKET ? round1((100 * a.pieceErrors[i]!) / moves) : null };
  });
}
