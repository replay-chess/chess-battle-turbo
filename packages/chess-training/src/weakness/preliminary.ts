// Preliminary patterns for the insufficient state (phase-06 plan §8.10): from 5 analysed games, candidates seen in at
// least 2 games, by games then events, top 3: "Missed forks · Seen in 5 of 14 games · Preliminary". Empty below 5.
import { isWeaknessCandidate, weaknessLabel } from "../themes";
import { type Aggregate, patternAgg } from "./aggregate";
import { GAMES_REQUIRED, PRELIMINARY_FROM, PRELIMINARY_MIN_GAMES, PRELIMINARY_ROWS } from "./constants";
import { candidateKeys } from "./patterns";

export interface PreliminaryRow {
  pattern: string;
  label: string;
  seenIn: number;
  of: number;
}

export function preliminaryPatterns(a: Aggregate, analysed: number, isCandidate: (key: string) => boolean = isWeaknessCandidate): PreliminaryRow[] {
  if (analysed < PRELIMINARY_FROM || analysed >= GAMES_REQUIRED) return [];
  return candidateKeys(a, isCandidate)
    .map((key) => ({ key, agg: patternAgg(a, key) }))
    .filter((x) => x.agg.games.size >= PRELIMINARY_MIN_GAMES)
    .sort((x, y) => y.agg.games.size - x.agg.games.size || y.agg.k - x.agg.k || (x.key < y.key ? -1 : 1))
    .slice(0, PRELIMINARY_ROWS)
    .map((x) => ({ pattern: x.key, label: weaknessLabel(x.key), seenIn: x.agg.games.size, of: analysed }));
}
