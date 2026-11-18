// Phase 6 persona states (phase-06 plan §6.8; testing X4): the Weakness Profile states the e2e specs lease and the
// plan's dev-seed states (registered as `dev-weak-*`: P1/P4/P5 already own `member`, `trial` and `new`). Pure module:
// no Prisma import, so unit tests and Playwright can load it. The writer is ./p06-personas.ts.
//
// Every state is made of REAL games (the CC0 Lichess extract `@repo/chess-fixtures/weakness/persona-games.json`) and
// the product's own pipelines: the writer puts the games on the leased user as finished online games, the running
// analysis worker grades them (ANALYZE_GAME: the five P6 input columns, J1's bank, the first-build triggers), and
// RECOMPUTE_WEAKNESS writes the snapshot. Nothing about the profile is hand-written; the numbers a spec asserts are read
// back from the member's own TR-5 payload. A state only shapes the history (which games, which are analysed, a
// crashed last attempt, a missing snapshot) the way a real member's history would be.
//
// | persona            | games (cell × n)                          | after the pipelines                               | page state                       |
// |--------------------|-------------------------------------------|---------------------------------------------------|----------------------------------|
// | weak-zero, -fresh  | none                                      | —                                                 | insufficient (0 of 20)           |
// | weak-few           | 1200 blitz 3                              | analysed; no build (first_build starts at 5)      | insufficient, no preliminary row |
// | weak-insufficient  | 1200 blitz 9 + rapid 5 (trialist)         | analysed; INSUFFICIENT snapshot                   | insufficient + preliminary rows  |
// | bullet             | 1200 bullet 20 + blitz 6                  | analysed; INSUFFICIENT (scope without bullet)     | insufficient + the bullet offer  |
// | weak-computing     | 1500 blitz 17 + rapid 8                   | 12 newest analysed; 13 ANALYZE_GAME jobs frozen   | computing (12 of 25)             |
// | weak-orphaned      | 1500 blitz 16 + rapid 6                   | analysed; snapshot and job removed                | computing, orphaned (auto-build) |
// | weakfail           | 1500 blitz 22                             | analysed; a crashed last attempt, reaped          | failed                           |
// | weak-member        | 1500 blitz 36 + rapid 18                  | analysed; READY                                   | ready (profile, drill, dot)      |
// | noclock            | 1500 blitz 20 + rapid 10, clocks removed  | analysed; READY without clock data                | ready without the Clock tab      |
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export type P06Band = "R800_1200" | "R1200_1600";
export type P06Cell = "1500:BLITZ" | "1500:RAPID" | "1200:BLITZ" | "1200:RAPID" | "1200:BULLET";

/** One persona game of the CC0 extract (apps/web/e2e/scripts/build-weakness-games.ts `PersonaGame`). */
export interface P06SourceGame {
  k: string;
  tc: string;
  c: "w" | "b";
  elo: number;
  oppElo: number;
  res: "1-0" | "0-1" | "1/2-1/2";
  term: string;
  eco: string | null;
  uci: string;
  clk: number[];
}

/** What happens after the persona's games are analysed. */
export type P06Finish =
  /** Nothing more: no recompute is asked for (fewer than 5 games: the worker's first build has not started). */
  | "none"
  /** One recompute settles the snapshot on every analysed game (READY or INSUFFICIENT, as the data decides). */
  | "settle"
  /** settle, then the games past `analyse` get ANALYZE_GAME jobs due in two years: a build that is still grading. */
  | "computing"
  /** settle, then the snapshots and the job row are removed: analysed games that nothing will build (backfill gap). */
  | "orphaned"
  /** settle, then the snapshots are removed and the recompute's last attempt is left RUNNING by a dead worker; the
   *  running worker's reaper fails it and writes the FAILED snapshot (`worker_stalled`). */
  | "failed";

export interface P06PersonaState {
  name: string;
  description: string;
  /** The design state(s) the persona reaches on /train/weakness. */
  states: string[];
  billing: "member" | "trial";
  timeZone: string;
  ratingBand: P06Band;
  /** The games, newest first in the order given (the cells interleave over `spanDays`). */
  games: { cell: P06Cell; count: number }[];
  /** The newest game ended this many days ago; the oldest about `spanDays` later. */
  newestDaysAgo: number;
  spanDays: number;
  /** How many of the games (newest first) are analysed; default all. */
  analyse?: number;
  /** Games written without clocks (OTB-style records). */
  noClocks?: boolean;
  finish: P06Finish;
  /**
   * Keep the user's games and analyses when they already are exactly this persona's (same refs, all analysed, written
   * less than REUSE_MAX_AGE_MS ago): the reset then only re-extracts the bank and rebuilds the snapshot. The heavy
   * personas use it; weak-computing never does (its "stalled" check reads the analyses' completion time).
   */
  reuse: boolean;
}

/** A kept game set is re-used only while its dates are this fresh (the scope window and weekly buckets move). */
export const REUSE_MAX_AGE_MS = 6 * 3_600_000;

/** The first-build thresholds of the worker (5, 10, 15, 20): fewer analysed games never get a snapshot by themselves. */
export const FIRST_BUILD_FROM = 5;

const S = (s: P06PersonaState) => s;

export const P06_POOL_PERSONAS = {
  "weak-zero": S({
    name: "weak-zero",
    description: "Member with no games: insufficient, 0 of 20 analysed, the import CTA",
    states: ["V3WeaknessInsufficient.insufficient"],
    billing: "member",
    timeZone: "UTC",
    ratingBand: "R1200_1600",
    games: [],
    newestDaysAgo: 1,
    spanDays: 1,
    finish: "none",
    reuse: false,
  }),
  "weak-fresh": S({
    name: "weak-fresh",
    description: "Member with no games who may link the Lichess fixture account (owner test T2, the nightly import check)",
    states: ["V3WeaknessInsufficient.insufficient"],
    billing: "member",
    timeZone: "UTC",
    ratingBand: "R1200_1600",
    games: [],
    newestDaysAgo: 1,
    spanDays: 1,
    finish: "none",
    reuse: false,
  }),
  "weak-few": S({
    name: "weak-few",
    description: "Member with 3 analysed blitz games: insufficient, no preliminary pattern yet",
    states: ["V3WeaknessInsufficient.insufficient"],
    billing: "member",
    timeZone: "Europe/Berlin",
    ratingBand: "R800_1200",
    games: [{ cell: "1200:BLITZ", count: 3 }],
    newestDaysAgo: 1,
    spanDays: 10,
    finish: "none",
    reuse: false,
  }),
  "weak-insufficient": S({
    name: "weak-insufficient",
    description: "Trialist with 14 analysed rapid/blitz games: insufficient with preliminary patterns",
    states: ["V3WeaknessInsufficient.insufficient"],
    billing: "trial",
    timeZone: "Asia/Kolkata",
    ratingBand: "R800_1200",
    games: [
      { cell: "1200:BLITZ", count: 9 },
      { cell: "1200:RAPID", count: 5 },
    ],
    newestDaysAgo: 2,
    spanDays: 40,
    finish: "settle",
    reuse: true,
  }),
  bullet: S({
    name: "bullet",
    description: "Member with 20 bullet and 6 blitz games, all analysed: insufficient, and the offer to include bullet",
    states: ["V3WeaknessInsufficient.insufficient"],
    billing: "member",
    timeZone: "America/New_York",
    ratingBand: "R800_1200",
    games: [
      { cell: "1200:BULLET", count: 20 },
      { cell: "1200:BLITZ", count: 6 },
    ],
    newestDaysAgo: 1,
    spanDays: 90,
    finish: "settle",
    reuse: true,
  }),
  "weak-computing": S({
    name: "weak-computing",
    description: "Member with 25 games in scope, the 12 newest analysed, 13 still queued: computing at about half",
    states: ["V3WeaknessComputing.computing"],
    billing: "member",
    timeZone: "America/Sao_Paulo",
    ratingBand: "R1200_1600",
    games: [
      { cell: "1500:BLITZ", count: 17 },
      { cell: "1500:RAPID", count: 8 },
    ],
    newestDaysAgo: 1,
    spanDays: 60,
    analyse: 12,
    finish: "computing",
    reuse: false,
  }),
  "weak-orphaned": S({
    name: "weak-orphaned",
    description: "Member with 22 analysed games, no snapshot and no job: the page asks for the build itself",
    states: ["V3WeaknessComputing.computing"],
    billing: "member",
    timeZone: "Australia/Sydney",
    ratingBand: "R1200_1600",
    games: [
      { cell: "1500:BLITZ", count: 16 },
      { cell: "1500:RAPID", count: 6 },
    ],
    newestDaysAgo: 2,
    spanDays: 70,
    finish: "orphaned",
    reuse: true,
  }),
  weakfail: S({
    name: "weakfail",
    description: "Member with 22 analysed blitz games whose recompute died on its last attempt: failed, Retry",
    states: [],
    billing: "member",
    timeZone: "Europe/Berlin",
    ratingBand: "R1200_1600",
    games: [{ cell: "1500:BLITZ", count: 22 }],
    newestDaysAgo: 3,
    spanDays: 60,
    finish: "failed",
    reuse: true,
  }),
  "weak-member": S({
    name: "weak-member",
    description: "Member with 54 analysed blitz/rapid games, the bank from them and a READY profile (rows, drill, dot)",
    states: ["V3WeaknessProfile.default", "V3WeaknessDrill.drill"],
    billing: "member",
    timeZone: "America/Los_Angeles",
    ratingBand: "R1200_1600",
    games: [
      { cell: "1500:BLITZ", count: 36 },
      { cell: "1500:RAPID", count: 18 },
    ],
    newestDaysAgo: 1,
    spanDays: 150,
    finish: "settle",
    reuse: true,
  }),
  noclock: S({
    name: "noclock",
    description: "Member with 30 analysed games recorded without clocks: a profile without the Clock tab",
    states: ["V3WeaknessProfile.default"],
    billing: "member",
    timeZone: "Asia/Tokyo",
    ratingBand: "R1200_1600",
    games: [
      { cell: "1500:BLITZ", count: 20 },
      { cell: "1500:RAPID", count: 10 },
    ],
    newestDaysAgo: 1,
    spanDays: 120,
    noClocks: true,
    finish: "settle",
    reuse: true,
  }),
} as const satisfies Record<string, P06PersonaState>;

/** The plan's dev-seed personas (§6.8 "Dev seed personas"), each the same state as its pool twin. */
export const P06_SEED_PERSONAS = {
  "dev-weak-new": { ...P06_POOL_PERSONAS["weak-zero"], name: "dev-weak-new" },
  "dev-weak-trial": { ...P06_POOL_PERSONAS["weak-insufficient"], name: "dev-weak-trial" },
  "dev-weak-member": { ...P06_POOL_PERSONAS["weak-member"], name: "dev-weak-member" },
  "dev-weak-compute": { ...P06_POOL_PERSONAS["weak-computing"], name: "dev-weak-compute" },
  "dev-weak-fail": { ...P06_POOL_PERSONAS.weakfail, name: "dev-weak-fail" },
  "dev-weak-bullet": { ...P06_POOL_PERSONAS.bullet, name: "dev-weak-bullet" },
  "dev-weak-noclock": { ...P06_POOL_PERSONAS.noclock, name: "dev-weak-noclock" },
} as const satisfies Record<string, P06PersonaState>;

export const P06_PERSONA_STATES: Readonly<Record<string, P06PersonaState>> = { ...P06_POOL_PERSONAS, ...P06_SEED_PERSONAS };

export type P06PoolPersonaName = keyof typeof P06_POOL_PERSONAS;
export type P06SeedPersonaName = keyof typeof P06_SEED_PERSONAS;
export type P06PersonaName = P06PoolPersonaName | P06SeedPersonaName;

/** The plan's dev-seed names (§6.8) → the persona tool's names. */
export const P06_DEV_SEED_NAMES = {
  new: "dev-weak-new",
  trial: "dev-weak-trial",
  member: "dev-weak-member",
  weakcompute: "dev-weak-compute",
  weakfail: "dev-weak-fail",
  bullet: "dev-weak-bullet",
  noclock: "dev-weak-noclock",
} as const satisfies Record<string, P06SeedPersonaName>;

/** The persona step a spec runs after the lease (`weak-computing:ready`): the frozen analyses run, the build finishes. */
export const P06_STEPS = { "weak-computing:ready": "weak-computing" } as const;
export type P06StepName = keyof typeof P06_STEPS;

export function getP06PersonaState(name: string): P06PersonaState {
  const s = P06_PERSONA_STATES[name];
  if (!s) throw new Error(`unknown P6 persona "${name}" (known: ${Object.keys(P06_PERSONA_STATES).join(", ")})`);
  return s;
}

// ── The games ──────────────────────────────────────────────────────────────────────────────────────────────────

let extract: Record<P06Cell, P06SourceGame[]> | null = null;

/** The CC0 extract, by cell. */
export function personaSourceGames(): Record<P06Cell, P06SourceGame[]> {
  if (extract) return extract;
  const file = createRequire(import.meta.url).resolve("@repo/chess-fixtures/weakness/persona-games.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { v: number; cells: Record<P06Cell, P06SourceGame[]> };
  if (parsed.v !== 1) throw new Error(`persona-games.json: unknown version ${parsed.v}`);
  extract = parsed.cells;
  return extract;
}

export interface PlannedGame {
  /** The fixture key (deterministic per persona and source game; the ref also depends on the member). */
  key: string;
  source: P06SourceGame;
  /** When the game ended. */
  endedAt: Date;
  analyse: boolean;
}

const DAY_MS = 86_400_000;

/**
 * The persona's games, newest first: the cells interleave (a member's history mixes time classes), the newest ended
 * `newestDaysAgo` days before `now` (at whole minutes, so two resets in the same minute give the same rows), the rest
 * spread over `spanDays` with an hour offset per game. The first `analyse` (default all) are analysed.
 */
export function planGames(s: P06PersonaState, now: Date, games: Record<P06Cell, P06SourceGame[]> = personaSourceGames()): PlannedGame[] {
  const picked: P06SourceGame[] = [];
  for (const part of s.games) {
    const cell = games[part.cell];
    if (!cell || cell.length < part.count) throw new Error(`${s.name}: the extract has ${cell?.length ?? 0} ${part.cell} games, ${part.count} wanted`);
    picked.push(...cell.slice(0, part.count));
  }
  // A fixed shuffle (multiplicative order), so blitz and rapid alternate through the history.
  const n = picked.length;
  const order = picked.map((g, i) => ({ g, k: (i * 7919) % Math.max(1, n) })).sort((a, b) => a.k - b.k || a.g.k.localeCompare(b.g.k));
  const anchor = Math.floor(now.getTime() / 60_000) * 60_000;
  const analyse = s.analyse ?? n;
  return order.map(({ g }, i) => ({
    key: `p6:${s.games.map((p) => `${p.cell}x${p.count}`).join("+")}:${g.k}`,
    source: g,
    endedAt: new Date(anchor - (s.newestDaysAgo + (i * s.spanDays) / Math.max(1, n)) * DAY_MS - (i % 9) * 3_600_000),
    analyse: i < analyse,
  }));
}

/** "180+2" → seconds. */
export function timeControlOf(tc: string): { initialSeconds: number; incrementSeconds: number } {
  const [a, b] = tc.split("+");
  const initialSeconds = Number(a);
  const incrementSeconds = Number(b ?? 0);
  if (!Number.isInteger(initialSeconds) || initialSeconds <= 0 || !Number.isInteger(incrementSeconds) || incrementSeconds < 0) {
    throw new Error(`time control "${tc}" is not <initial>+<increment>`);
  }
  return { initialSeconds, incrementSeconds };
}
