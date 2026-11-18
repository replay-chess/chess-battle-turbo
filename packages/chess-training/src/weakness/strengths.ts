// Strengths, at most 2, in priority order (phase-06 plan §8.20; copy note C10 "won positions"). `strengthKeys` are
// stored for P10's profile card. Pure.
import type { AnalysedGame } from "./aggregate";
import { type BandMix, bandValue } from "./band";
import type { PhaseRowDoc } from "./breakdown";
import {
  BOOK_EXIT_EQUAL_WIN,
  BOOK_EXIT_MIN_GAMES,
  BOOK_EXIT_MIN_SHARE,
  CONVERSION_GAMES,
  CONVERSION_MIN_REACHED,
  CONVERSION_MIN_RATE,
  PHASE_STRENGTH_DELTA,
  STRENGTH_BAND_MARGIN,
  STRENGTHS_MAX,
} from "./constants";
import { byNewest } from "./scope";
import type { StrengthKey } from "./types";

export interface Strengths {
  sentences: string[];
  keys: StrengthKey[];
}

/** Conversion over the newest 30 analysed games (STATS_V1 slots 27, 28). */
export function conversionOf(games: readonly AnalysedGame[]): { reached: number; converted: number } {
  const newest = [...games].sort((a, b) => byNewest(a.g, b.g)).slice(0, CONVERSION_GAMES);
  let reached = 0;
  let converted = 0;
  for (const { d } of newest) {
    if (d.stats.reachedPlus3) reached += 1;
    if (d.stats.converted) converted += 1;
  }
  return { reached, converted };
}

/** Book exit per colour (STATS_V1 slot 29): games with a known Win% after the first non-book move, and the equal ones. */
export function bookExitOf(games: readonly AnalysedGame[]): Record<"w" | "b", { n: number; equal: number }> {
  const out = { w: { n: 0, equal: 0 }, b: { n: 0, equal: 0 } };
  for (const { g, d } of games) {
    const win = d.stats.bookExitWin;
    if (win === null) continue;
    out[g.color].n += 1;
    if (win >= BOOK_EXIT_EQUAL_WIN) out[g.color].equal += 1;
  }
  return out;
}

const PHASE_WORD = { opening: "opening", middlegame: "middlegame", endgame: "endgame" } as const;

export function strengthsOf(games: readonly AnalysedGame[], phaseRows: readonly PhaseRowDoc[], mix: BandMix | null): Strengths {
  const sentences: string[] = [];
  const keys: StrengthKey[] = [];
  // 1. Conversion.
  const conv = conversionOf(games);
  const bandConv = mix ? bandValue(mix, (c) => c.conversion, null) : null;
  if (conv.reached >= CONVERSION_MIN_REACHED && conv.converted / conv.reached >= Math.max(CONVERSION_MIN_RATE, (bandConv ?? 0) + STRENGTH_BAND_MARGIN)) {
    sentences.push(`You convert won positions: ${conv.converted} of your last ${conv.reached} games that reached +3 or better ended in a win.`);
    keys.push("conversion");
  }
  // 2. Book exit: the better colour that qualifies.
  const exits = bookExitOf(games);
  const qualified = (["w", "b"] as const)
    .map((c) => {
      const { n, equal } = exits[c];
      const bandShare = mix ? bandValue(mix, (cell) => cell.bookExitEqualShare[c], null) : null;
      const share = n > 0 ? equal / n : 0;
      return { c, share, ok: n >= BOOK_EXIT_MIN_GAMES && share >= Math.max(BOOK_EXIT_MIN_SHARE, (bandShare ?? 0) + STRENGTH_BAND_MARGIN) };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.share - a.share);
  const exit = qualified[0];
  if (exit) {
    sentences.push(
      `Your openings as ${exit.c === "w" ? "White" : "Black"} are sound: you leave book with an equal position ${Math.round(exit.share * 100)}% of the time.`,
    );
    keys.push(exit.c === "w" ? "book_exit_w" : "book_exit_b");
  }
  // 3. Phase: the largest you − band ≥ 3.
  const phase = phaseRows
    .filter((r): r is PhaseRowDoc & { you: number; band: number } => r.you !== null && r.band !== null && r.you - r.band >= PHASE_STRENGTH_DELTA)
    .sort((a, b) => b.you - b.band - (a.you - a.band))[0];
  if (phase) {
    sentences.push(`Your ${PHASE_WORD[phase.phase]} accuracy is ${phase.you}, above players at your level (${phase.band}).`);
    keys.push(`phase_${phase.phase}`);
  }
  return { sentences: sentences.slice(0, STRENGTHS_MAX), keys: keys.slice(0, STRENGTHS_MAX) };
}
