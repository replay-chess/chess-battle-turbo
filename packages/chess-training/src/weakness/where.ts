// The "where" line and the last-20 count (phase-06 plan §8.19): `phaseMode` = the phase with the most events (ties
// to the middlegame); `last20` = the newest min(20, |G|) analysed games and `g20` = how many of them carry the pattern:
// "Middlegame · 7 of the last 20 games"; time pressure: "Under 1 minute · 4 of the last 20 games".
import { type AnalysedGame, aggregate, patternAgg, type Aggregate } from "./aggregate";
import { WHERE_LAST_N } from "./constants";
import { byNewest } from "./scope";

/** The aggregate of the newest WHERE_LAST_N analysed games, and how many there are. */
export function last20(games: readonly AnalysedGame[]): { agg: Aggregate; n: number } {
  const newest = [...games].sort((a, b) => byNewest(a.g, b.g)).slice(0, WHERE_LAST_N);
  return { agg: aggregate(newest), n: newest.length };
}

/** Games among the last 20 with at least one event of the pattern. */
export function gamesWithLast20(l20: { agg: Aggregate }, key: string): number {
  return patternAgg(l20.agg, key).games.size;
}
