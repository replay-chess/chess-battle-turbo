// /dev/ui/games fixtures (plan §4.10): the contract's archive rows (every analysis status, member and bot opponents,
// a legend row) plus generated rows, so the demo pages like the real list (30 per page, keyset order), and a stress
// set (TST X9: 120 rows, 20-character names, the longest opening, both colours).
import { gameRowFixtures } from "@repo/contracts/http/fixtures/review";
import { PAGE_LIMIT, type GamesFilter } from "../model/filter";
import type { GameRowDTO } from "../model/rows";

export const DEMO_STATES = ["default", "filters_open", "empty", "loading", "error"] as const;
export type DemoState = (typeof DEMO_STATES)[number];

export function isDemoState(s: string | undefined): s is DemoState {
  return (DEMO_STATES as readonly string[]).includes(s ?? "");
}

const OPPONENTS = [
  ["pawnstorm22", 1221],
  ["e4_enjoyer", 1166],
  ["bishop_pair_bob", 1178],
  ["lucena_now", 1192],
  ["knightrider", 1150],
  ["gm_wannabe", 1240],
  ["martin_k", 1212],
  ["tal_fan_77", 1203],
] as const;
const OPENINGS = [
  { eco: "D35", name: "Queen's Gambit Declined" },
  { eco: "B22", name: "Sicilian Defense: Alapin Variation" },
  { eco: "B12", name: "Caro-Kann Defense: Advance Variation" },
  { eco: "D02", name: "London System" },
  { eco: "C50", name: "Italian Game" },
  { eco: "C18", name: "French Defense: Winawer Variation" },
] as const;
const TCS = [
  { label: "Rapid 10+0", timeClass: "rapid" },
  { label: "Blitz 5+0", timeClass: "blitz" },
  { label: "Blitz 3+2", timeClass: "blitz" },
  { label: "Bullet 1+0", timeClass: "bullet" },
  { label: "Classical 30+0", timeClass: "classical" },
  { label: "Rapid 15+10", timeClass: "rapid" },
] as const;
const RESULTS = ["loss", "win", "draw", "win", "loss"] as const;
const HEADLINES = ["Dropped a bishop · move 16", "Missed recapture · move 13", "Repetition · move 31", "Clean game", "Fork on f7 · move 11", "Back rank · move 30"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const FENS = [
  "r3k2r/1p3p2/1np2pb1/p2p3p/3P1b1P/2NBP1P1/PP1K1P2/R6R w kq - 0 16",
  "r2qk2r/pp2ppbp/1nN3p1/8/3P4/8/PP3PPP/RNBQR1K1 b kq - 0 13",
  "r3r1k1/p1q2ppb/2p2n1p/8/8/1PNNPBbP/P1PQ2P1/R4RK1 w - - 5 21",
  "6k1/R4ppp/8/8/8/8/5PPP/3r2K1 w - - 2 31",
];

/** A deterministic 25-character cuid-shaped ref (`c` + 24). */
function demoRef(i: number, stress: boolean): string {
  return `c${stress ? "s" : "d"}${String(i).padStart(4, "0")}demo${"x".repeat(15)}`;
}

function generated(i: number, stress: boolean): GameRowDTO {
  const [name, rating] = OPPONENTS[i % OPPONENTS.length]!;
  const opening = OPENINGS[i % OPENINGS.length]!;
  const tc = TCS[i % TCS.length]!;
  // Every 20 hours back from Oct 30 (keyset order: newest first, no ties).
  const at = new Date(Date.UTC(2026, 9, 30, 12) - i * 20 * 3_600_000);
  const moments = i % 4 === 0 ? 0 : (i % 3) + 1;
  const longName = "ThisIsATwentyCharNam".slice(0, 20);
  return {
    ref: demoRef(i, stress),
    color: i % 2 === 0 ? "w" : "b",
    result: RESULTS[i % RESULTS.length]!,
    opponent: { name: stress ? longName : name, rating: stress ? 2999 : rating, kind: "member" },
    headline: moments === 0 ? "Clean game" : HEADLINES[i % HEADLINES.length]!,
    opening: stress ? { eco: "B33", name: "Sicilian Defense: Lasker-Pelikan Variation, Sveshnikov Variation, Chelyabinsk Variation" } : opening,
    positionTitle: null,
    tc: { label: tc.label, timeClass: tc.timeClass },
    playedAt: at.toISOString(),
    playedAtLabel: `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`,
    ratingDelta: null,
    source: "replay",
    finalFen: FENS[i % FENS.length]!,
    analysisStatus: "done",
    momentsCount: moments,
    accuracy: 60 + ((i * 7) % 38),
    hasComparison: false,
  };
}

/** 40 rows by default (page 1 = 30, page 2 = 10), 120 with stress. Newest first, as G1 orders them. */
export function demoRows(stress = false): GameRowDTO[] {
  if (stress) return Array.from({ length: 120 }, (_, i) => generated(i, true));
  return [...gameRowFixtures(), ...Array.from({ length: 32 }, (_, i) => generated(i, false))];
}

/** The G1 filter applied to rows in memory (the §9.3 WHERE clause: result, time class, moments, search). */
export function rowMatches(row: GameRowDTO, f: GamesFilter): boolean {
  if (f.result?.length && !f.result.includes(row.result)) return false;
  if (f.tc?.length && !(row.tc.timeClass && (f.tc as readonly string[]).includes(row.tc.timeClass))) return false;
  if (f.moments && row.momentsCount <= 0) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [row.opponent.name, row.opening?.name, row.positionTitle].filter(Boolean).map((s) => s!.toLowerCase());
    if (!hay.some((s) => s.includes(q))) return false;
  }
  return true;
}

/** One keyset page of the filtered rows: `pages` pages of 30. */
export function demoPage(rows: GameRowDTO[], f: GamesFilter, pages: number): { rows: GameRowDTO[]; total: number; hasNext: boolean } {
  const all = rows.filter((r) => rowMatches(r, f));
  const shown = all.slice(0, pages * PAGE_LIMIT);
  return { rows: shown, total: all.length, hasNext: shown.length < all.length };
}
