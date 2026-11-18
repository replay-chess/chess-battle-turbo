// Openings breakdown (phase-06 plan §8.9). Over ALL in-scope games with an ECO code (analysis is not needed): the
// family (CA/src/eco-families.ts), games, points (win 1, draw ½) and the score. Families with ≥ 3 games; the 4 most
// played (ties: the most points lost); the notes "Most played" (≥ 5 games), "Most points lost" (games·(½ − score) > 0)
// and "Best score" (≥ 10 games), each on the row it describes (FIX-1). Pure.
import { ecoFamily, ecoRange } from "@repo/chess-analysis/eco-families";
import { BEST_SCORE_MIN_GAMES, MOST_PLAYED_MIN_GAMES, OPENINGS_MIN_GAMES, OPENINGS_ROWS } from "./constants";
import type { OpeningRowDoc, WeaknessGameInput } from "./types";

const POINTS: Readonly<Record<string, number>> = { WIN: 1, DRAW: 0.5, LOSS: 0 };

export function openingsBreakdown(games: readonly Pick<WeaknessGameInput, "ecoCode" | "result">[]): OpeningRowDoc[] {
  const fams = new Map<string, { family: string; ecoRange: string; games: number; points: number }>();
  for (const g of games) {
    const fam = ecoFamily(g.ecoCode);
    const pts = g.result ? POINTS[g.result] : undefined;
    if (!fam || pts === undefined) continue;
    const row = fams.get(fam.name) ?? { family: fam.name, ecoRange: ecoRange(fam), games: 0, points: 0 };
    row.games += 1;
    row.points += pts;
    fams.set(fam.name, row);
  }
  const lost = (r: { games: number; points: number }) => r.games * 0.5 - r.points;
  const rows: OpeningRowDoc[] = [...fams.values()]
    .filter((r) => r.games >= OPENINGS_MIN_GAMES)
    .sort((a, b) => b.games - a.games || lost(b) - lost(a) || (a.family < b.family ? -1 : 1))
    .slice(0, OPENINGS_ROWS)
    .map((r) => ({ ...r, scorePct: Math.round((100 * r.points) / r.games), note: null }));
  // Each note names the row it describes (FIX-1, docs/decisions.md D-P6-FIX1-1): the true argmax over the shown rows,
  // never "the best of the rows still free". A row that earns two notes shows the more useful one, in this order:
  // most points lost (where to work), best score (what works), most played (the games column already says it).
  const argmax = (pool: OpeningRowDoc[], key: (r: OpeningRowDoc) => number) =>
    pool.reduce<OpeningRowDoc | undefined>((best, r) => (best === undefined || key(r) > key(best) ? r : best), undefined);
  const mostLost = argmax(rows.filter((r) => lost(r) > 0), lost);
  const best = argmax(rows.filter((r) => r.games >= BEST_SCORE_MIN_GAMES), (r) => r.scorePct + r.games / 1e6);
  const mostPlayed = argmax(rows.filter((r) => r.games >= MOST_PLAYED_MIN_GAMES), (r) => r.games);
  for (const [row, note] of [[mostLost, "most_points_lost"], [best, "best_score"], [mostPlayed, "most_played"]] as const) {
    if (row && row.note === null) row.note = note;
  }
  return rows;
}
