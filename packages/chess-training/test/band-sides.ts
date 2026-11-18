// FX `weakness/band-sides-1600-blitz.json` (FIX-2): 1,017 real J5 sides of the v1 cells 1500:BLITZ and 1600:BLITZ with
// Elo 1550–1649, as the weakness engine's game inputs, and a seeded sampler of simulated members made of them. Test
// support only (the eligibility and trend tests on real band sides).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { asAnalysed } from "../scripts/baseline/aggregate";
import type { SideRecord } from "../scripts/baseline/side";
import type { AnalysedGame } from "../src/weakness/aggregate";

const require = createRequire(import.meta.url);

interface BandSidesFile {
  v: 1;
  sides: SideRecord[];
}

let cache: SideRecord[] | null = null;

/** The fixture's side records (read once). */
export function bandSides(): SideRecord[] {
  cache ??= (JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/weakness/band-sides-1600-blitz.json"), "utf8")) as BandSidesFile).sides;
  return cache;
}

/** mulberry32: a small seeded generator (deterministic members in every run). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** True when the side has an event of `theme` (time pressure: a blunder under a minute is not visible here). */
export function sideHas(r: SideRecord, theme: string): boolean {
  return r.inputs.errorThemes.includes(theme);
}

/**
 * A simulated member: `n` distinct sides drawn at random (each one game side of the member), BLITZ, Lichess-rated.
 * `boost` multiplies the draw weight of sides carrying a theme (a real excess made of real games), `endedAt` dates them.
 */
export function member(
  next: () => number,
  n: number,
  o: { boost?: { theme: string; weight: number }; endedAt?: (i: number) => Date | null; pool?: readonly SideRecord[] } = {},
): AnalysedGame[] {
  const pool = o.pool ?? bandSides();
  if (n > pool.length) throw new RangeError(`a member of ${n} distinct sides from a pool of ${pool.length}`);
  const out: AnalysedGame[] = [];
  const used = new Set<number>();
  while (out.length < n) {
    const at = Math.floor(next() * pool.length);
    // Distinct sides: a member's games are different games (a side drawn twice would be one game counted twice).
    if (used.has(at)) continue;
    const r = pool[at]!;
    // A side with the theme is always taken, one without it with probability 1/weight: the theme's games are `weight`×
    // as frequent as in the band (its rate per move rises by a little less: those games also have more moves).
    if (o.boost && !sideHas(r, o.boost.theme) && next() > 1 / o.boost.weight) continue;
    used.add(at);
    const a = asAnalysed(r);
    const i = out.length;
    a.g = { ...a.g, gameId: String(i + 1), timeClass: "BLITZ", endedAt: o.endedAt ? o.endedAt(i) : null };
    out.push(a);
  }
  return out;
}
