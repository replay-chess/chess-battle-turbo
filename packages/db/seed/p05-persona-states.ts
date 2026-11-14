// Phase 5 persona states (phase-05 plan 6.7; testing X4): the Mistake Bank, Train and Home states e2e specs lease
// (`bank-member`, `bank-empty`, `bank-caughtup`, `puzzles-fresh`, `outbox`, `two-tabs`, `train-plan`, `day-rollover`,
// `home-new`) and the plan's dev-seed states (`member`, `caughtup`, `trial`, `new`, `perfect`, registered by the web
// as `dev-*` because P1/P4 already own those names). Pure data and pure helpers: no Prisma import, so Playwright and
// the web's persona registry (apps/web/e2e/personas/p05.ts) can load it. The writer is ./p05-personas.ts.
//
// Every state is generated relative to the reset's `now` (plan 6.7: "due today" is due on the day the reset runs) with
// a fixed PRNG (mulberry32, seed 42), so a reset run twice writes the same rows. The bank positions are the key moments
// of real analysed games (P3's design GAME and the CC0 oracle archive games, ./builders.ts + ./review.ts), so every
// card, occurrence and "See It in Your Game" link points at a position that exists in the member's own game.
//
// The domain rules a state needs (epdHash, the card key codec, the local day, the next release, card mastery) are not
// re-implemented here: the writer takes them as `TrainingDeps` from @repo/chess-analysis/epd and
// @repo/chess-training (the web's persona tool wires them), so persona rows are byte-for-byte what the worker writes.

export type CardStateDb = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

/** The domain functions a reset uses (handbacks/signatures.md: WP-B and WP-C own them). */
export interface TrainingDeps {
  /** fnv1a-64 of the EPD (FEN fields 1–4) as a signed int64 (@repo/chess-analysis/epd). */
  epdHash(fen: string): bigint;
  /** "m_" + sqid of the epdHash as two uint32 halves (@repo/chess-training/items). */
  mistakeItemKey(epdHash: bigint): string;
  /** The member's local training day "YYYY-MM-DD" (the day starts at dayStartHour; @repo/chess-training/day). */
  dayKey(now: Date, timeZone: string, dayStartHour: number): string;
  /** Today's local releaseHour if still ahead, else tomorrow's, as a UTC instant (@repo/chess-training/release). */
  nextRelease(now: Date, timeZone: string, releaseHour: number): Date;
  /** Card mastery 0–5 from the FSRS state and stability (@repo/chess-training/mastery, plan 8.8). */
  masteryOf(state: CardStateDb, stability: number): number;
}

/** The theme a persona position carries (the tagger is WP-C's; personas rotate through the design's themes). */
export const P05_PERSONA_THEMES = ["fork", "hangingPiece", "backRankMate", "pin", "rc:recapture", "rc:pawnStructure"] as const;

/** How the cards of a persona are scheduled relative to `now`. */
export type P05Schedule =
  /** `dueNow` cards due in the past (REVIEW/LEARNING), the rest spread over the next 14 days at the release hour. */
  | { kind: "spread"; dueNow: number }
  /** Nothing due; future dues in blocks per day offset (plan 6.7 caughtup: Tomorrow 6 · day 2 3 · day 3 5 · next week 9). */
  | { kind: "blocks"; blocks: readonly { days: number; n: number }[] }
  /** Every card NEW and due now (a fresh game's moments the morning after). */
  | { kind: "all_due" }
  /** Every card NEW and due at the next local release (the day-rollover spec moves time across it). */
  | { kind: "next_release" };

export interface P05ProfileSpec {
  rating: number;
  rd: number;
  puzzleAttempts: number;
  ratingSeeded: boolean;
  solveStreak: number;
  solveStreakBest: number;
  dayStreak: number;
  dayStreakBest: number;
  /** Local days before today of the last trained day; null = never trained. */
  lastActiveDaysAgo: number | null;
}

export interface P05ThemeSpec {
  theme: string;
  attempts: number;
  firstTry: number;
  ewma: number;
  milestonePct: number;
}

export interface P05PersonaState {
  name: string;
  /** The plan 6.7 name this state is (`member` for `bank-member`, …). */
  seed: string;
  description: string;
  /** Design states the persona reaches on real routes (`Board.state`), for the state-coverage check. */
  states: readonly string[];
  /** users."timeZone" after the reset. */
  timeZone: string;
  /** The analysed games the reset writes: P3's design GAME and the first `archives` analysed oracle games. */
  games: { game: boolean; archives: number };
  /** Distinct bank positions (mistakes) taken from those games' key moments, in game order; 0 = none. */
  mistakes: number;
  /** How many of them get a BANK card (the first ones). */
  cards: number;
  schedule: P05Schedule;
  /** null = no training_profiles row (created lazily by the first read). */
  profile: P05ProfileSpec | null;
  /** Local days before today with graded attempts (one BANK attempt per day on the first cards), oldest first. */
  trainedDaysAgo: readonly number[];
  /** Today's cap counters (caughtup: the cap is reached). */
  today: { bankReviewed: number; newIntroduced: number } | null;
  mastery: readonly P05ThemeSpec[];
  /** One COMPLETED five-item session, all first try, that crossed forks 70 % (V3SessionPerfect). */
  perfectSession: boolean;
}

// ── Shared pieces ───────────────────────────────────────────────────────────────────────────────────────────────
/** Puzzle rating 1512 (design), established (≥ 20 attempts), streak 4 ending yesterday, best 9. */
const ESTABLISHED: P05ProfileSpec = {
  rating: 1512,
  rd: 92,
  puzzleAttempts: 64,
  ratingSeeded: true,
  solveStreak: 4,
  solveStreakBest: 11,
  dayStreak: 4,
  dayStreakBest: 9,
  lastActiveDaysAgo: 1,
};

/** The hub's mastery bars (design: Forks 62 %, Loose pieces 55 %, Back rank 40 %, Pins 18 %). */
const DESIGN_MASTERY: readonly P05ThemeSpec[] = [
  { theme: "fork", attempts: 14, firstTry: 9, ewma: 0.62, milestonePct: 50 },
  { theme: "hangingPiece", attempts: 11, firstTry: 6, ewma: 0.55, milestonePct: 50 },
  { theme: "backRankMate", attempts: 6, firstTry: 2, ewma: 0.4, milestonePct: 0 },
  { theme: "pin", attempts: 9, firstTry: 2, ewma: 0.18, milestonePct: 0 },
];

const NONE = { mistakes: 0, cards: 0, trainedDaysAgo: [], today: null, mastery: [], perfectSession: false } as const;

function state(s: P05PersonaState): P05PersonaState {
  if (s.cards > s.mistakes) throw new Error(`${s.name}: more cards than mistakes`);
  if (s.schedule.kind === "spread" && s.schedule.dueNow > s.cards) throw new Error(`${s.name}: more due than cards`);
  if (s.schedule.kind === "blocks" && s.schedule.blocks.reduce((n, b) => n + b.n, 0) !== s.cards) {
    throw new Error(`${s.name}: the blocks must cover every card`);
  }
  return s;
}

// ── The lease pool (plan 6.7: e2e specs lease these) ───────────────────────────────────────────────────────────
export const P05_POOL_PERSONAS = {
  "bank-member": state({
    name: "bank-member",
    seed: "member",
    description: "Member with 41 bank positions from their games, 4 due today, streak 4 (best 9), puzzle rating 1512",
    states: ["V3MistakeBank.default", "V3TrainHub.default", "V3BankSession.solve", "V3Home.populated"],
    timeZone: "UTC",
    games: { game: true, archives: 23 },
    mistakes: 41,
    cards: 41,
    schedule: { kind: "spread", dueNow: 4 },
    profile: ESTABLISHED,
    trainedDaysAgo: [4, 3, 2, 1],
    today: null,
    mastery: DESIGN_MASTERY,
    perfectSession: false,
  }),
  "bank-empty": state({
    name: "bank-empty",
    seed: "new",
    description: "Member with one analysed game they have not reviewed, no bank positions, no linked account",
    states: ["V3BankEmpty.empty", "V3iPhoneBank.empty"],
    timeZone: "UTC",
    games: { game: true, archives: 0 },
    schedule: { kind: "all_due" },
    profile: null,
    ...NONE,
  }),
  "bank-caughtup": state({
    name: "bank-caughtup",
    seed: "caughtup",
    description: "Member who reviewed today's 10 (cap reached), nothing due; Tomorrow 6 · day 2 3 · day 3 5 · next week 9",
    states: ["V3BankCaughtUp.caughtup", "V3TrainHubDone.nothingdue", "V3iPhoneBank.caughtup"],
    timeZone: "UTC",
    games: { game: true, archives: 12 },
    mistakes: 23,
    cards: 23,
    schedule: { kind: "blocks", blocks: [{ days: 1, n: 6 }, { days: 2, n: 3 }, { days: 3, n: 5 }, { days: 8, n: 9 }] },
    profile: { ...ESTABLISHED, dayStreak: 5, lastActiveDaysAgo: 0 },
    trainedDaysAgo: [4, 3, 2, 1, 0],
    today: { bankReviewed: 10, newIntroduced: 2 },
    mastery: DESIGN_MASTERY,
    perfectSession: false,
  }),
  "puzzles-fresh": state({
    name: "puzzles-fresh",
    seed: "member",
    description: "Member with no puzzle attempts and the puzzle rating seeded at 1512 (provisional)",
    states: ["V3PuzzleSolve.solve", "V3PuzzleThemes.themes"],
    timeZone: "UTC",
    games: { game: false, archives: 0 },
    schedule: { kind: "all_due" },
    profile: { rating: 1512, rd: 250, puzzleAttempts: 0, ratingSeeded: true, solveStreak: 0, solveStreakBest: 0, dayStreak: 0, dayStreakBest: 0, lastActiveDaysAgo: null },
    ...NONE,
  }),
  outbox: state({
    name: "outbox",
    seed: "member",
    description: "Member with the three key moments of one game due now (the offline outbox spec grades them)",
    states: ["V3BankSession.solve"],
    timeZone: "UTC",
    games: { game: true, archives: 0 },
    mistakes: 3,
    cards: 3,
    schedule: { kind: "all_due" },
    profile: { ...ESTABLISHED, dayStreak: 0, lastActiveDaysAgo: null },
    trainedDaysAgo: [],
    today: null,
    mastery: [],
    perfectSession: false,
  }),
  "two-tabs": state({
    name: "two-tabs",
    seed: "member",
    description: "Member with exactly one due card (two tabs grade it; the second is a conflict)",
    states: ["V3BankSession.solve"],
    timeZone: "UTC",
    games: { game: true, archives: 0 },
    mistakes: 3,
    cards: 1,
    schedule: { kind: "all_due" },
    profile: { ...ESTABLISHED, dayStreak: 0, lastActiveDaysAgo: null },
    trainedDaysAgo: [],
    today: null,
    mastery: [],
    perfectSession: false,
  }),
  "train-plan": state({
    name: "train-plan",
    seed: "member",
    description: "Member with 3 due cards from one game and no plan built today (the hub builds it on the first read)",
    states: ["V3TrainHub.default"],
    timeZone: "UTC",
    games: { game: true, archives: 0 },
    mistakes: 3,
    cards: 3,
    schedule: { kind: "all_due" },
    profile: ESTABLISHED,
    trainedDaysAgo: [4, 3, 2, 1],
    today: null,
    mastery: DESIGN_MASTERY,
    perfectSession: false,
  }),
  "day-rollover": state({
    name: "day-rollover",
    seed: "member",
    description: "Member in America/New_York with 2 cards due at the next local 08:00 release",
    states: ["V3TrainHub.default", "V3TrainHubDone.nothingdue"],
    timeZone: "America/New_York",
    games: { game: true, archives: 0 },
    mistakes: 2,
    cards: 2,
    schedule: { kind: "next_release" },
    profile: { ...ESTABLISHED, dayStreak: 1, lastActiveDaysAgo: 1 },
    trainedDaysAgo: [1],
    today: null,
    mastery: [],
    perfectSession: false,
  }),
  "home-new": state({
    name: "home-new",
    seed: "new",
    description: "Member with no games, no bank, no linked account and no import",
    states: ["V3HomeNewUser.new_user", "V3Home.new_user"],
    timeZone: "UTC",
    games: { game: false, archives: 0 },
    schedule: { kind: "all_due" },
    profile: null,
    ...NONE,
  }),
} as const satisfies Record<string, P05PersonaState>;

// ── The plan's dev seed (plan 6.7 table), applied on dev with `seed-training.ts` ─────────────────────────────────
export const P05_SEED_PERSONAS = {
  "dev-member": state({ ...P05_POOL_PERSONAS["bank-member"], name: "dev-member", seed: "member" }),
  "dev-caughtup": state({ ...P05_POOL_PERSONAS["bank-caughtup"], name: "dev-caughtup", seed: "caughtup" }),
  "dev-trial": state({
    name: "dev-trial",
    seed: "trial",
    description: "Trial member while a Chess.com import runs (212 / 480, P4 import-trial), with 6 due cards",
    states: ["V3Home.import_running", "V3Home.trial"],
    timeZone: "UTC",
    games: { game: true, archives: 2 },
    mistakes: 6,
    cards: 6,
    schedule: { kind: "spread", dueNow: 6 },
    profile: { ...ESTABLISHED, dayStreak: 1, lastActiveDaysAgo: 1 },
    trainedDaysAgo: [1],
    today: null,
    mastery: [],
    perfectSession: false,
  }),
  "dev-new": state({ ...P05_POOL_PERSONAS["home-new"], name: "dev-new", seed: "new", states: ["V3HomeNewUser.new_user", "V3BankEmpty.empty"] }),
  "dev-perfect": state({
    ...P05_POOL_PERSONAS["bank-member"],
    name: "dev-perfect",
    seed: "perfect",
    description: "bank-member plus one completed five-item session, all first try, that crossed forks 70 %",
    states: ["V3SessionPerfect.perfect"],
    perfectSession: true,
  }),
} as const satisfies Record<string, P05PersonaState>;

export const P05_PERSONA_STATES: Readonly<Record<string, P05PersonaState>> = { ...P05_POOL_PERSONAS, ...P05_SEED_PERSONAS };

export type P05PoolPersonaName = keyof typeof P05_POOL_PERSONAS;
export type P05SeedPersonaName = keyof typeof P05_SEED_PERSONAS;
export type P05PersonaName = P05PoolPersonaName | P05SeedPersonaName;

/** The plan's dev-seed names → the registered state (`seed-training.ts --persona member` → `dev-member`). */
export const P05_DEV_SEED_NAMES = {
  member: "dev-member",
  caughtup: "dev-caughtup",
  trial: "dev-trial",
  new: "dev-new",
  perfect: "dev-perfect",
} as const satisfies Record<string, P05SeedPersonaName>;

export function getP05PersonaState(name: string): P05PersonaState {
  const s = P05_PERSONA_STATES[name];
  if (!s) throw new Error(`unknown P5 persona "${name}" (known: ${Object.keys(P05_PERSONA_STATES).join(", ")})`);
  return s;
}

// ── Pure helpers the writer and the tests share ────────────────────────────────────────────────────────────────
/** mulberry32: the plan's fixed-seed PRNG (seed 42). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const PERSONA_SEED = 42;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** One card's FSRS columns (state after its last review) and due instant. */
export interface CardSchedule {
  state: CardStateDb;
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  scheduledDays: number;
  lastReview: Date | null;
}

/**
 * The cards' schedules for a state, deterministic for (state, now, deps). Due days are snapped to the local release
 * hour (plan 8.4: an interval of a day or more lands on `releaseHour`); NEW cards come back at the next release.
 */
export function scheduleCards(s: P05PersonaState, now: Date, deps: Pick<TrainingDeps, "nextRelease">, releaseHour = 8): CardSchedule[] {
  const rnd = mulberry32(PERSONA_SEED);
  const release = deps.nextRelease(now, s.timeZone, releaseHour);
  const atRelease = (days: number) => new Date(release.getTime() + (days - 1) * DAY_MS);
  const out: CardSchedule[] = [];
  const review = (due: Date, stability: number, reps: number, last: Date): CardSchedule => ({
    state: "REVIEW",
    due,
    stability,
    difficulty: Math.round((4 + rnd() * 4) * 100) / 100,
    reps,
    lapses: reps > 3 ? 1 : 0,
    scheduledDays: Math.max(1, Math.round((due.getTime() - last.getTime()) / DAY_MS)),
    lastReview: last,
  });
  switch (s.schedule.kind) {
    case "spread": {
      for (let i = 0; i < s.cards; i++) {
        if (i < s.schedule.dueNow) {
          // Due 1–3 days ago, after a short interval (some still learning).
          const overdueDays = 1 + Math.floor(rnd() * 3);
          const due = new Date(now.getTime() - overdueDays * DAY_MS - Math.floor(rnd() * 6) * HOUR_MS);
          if (i % 3 === 2) {
            out.push({ state: "LEARNING", due, stability: 0.6, difficulty: 6.2, reps: 1, lapses: 0, scheduledDays: 0, lastReview: new Date(due.getTime() - 10 * 60_000) });
          } else {
            out.push(review(due, 1.5 + rnd() * 2, 2, new Date(due.getTime() - 2 * DAY_MS)));
          }
          continue;
        }
        // Spread over the next 14 days; stability grows with the interval (mastery 1–5).
        const days = 1 + Math.floor(rnd() * 14);
        const due = atRelease(days);
        const stability = [2, 6, 18, 45, 120][Math.min(4, Math.floor(rnd() * 5))]! + rnd();
        const last = new Date(due.getTime() - Math.max(1, Math.round(stability)) * DAY_MS);
        out.push(review(due, stability, 2 + Math.floor(rnd() * 6), last.getTime() < now.getTime() ? last : new Date(now.getTime() - DAY_MS)));
      }
      return out;
    }
    case "blocks": {
      for (const block of s.schedule.blocks) {
        for (let k = 0; k < block.n; k++) {
          const due = atRelease(block.days);
          const stability = Math.max(1.2, block.days * (1.1 + rnd() * 0.4));
          out.push(review(due, stability, 3, new Date(now.getTime() - (k % 2 === 0 ? 0 : DAY_MS) - HOUR_MS)));
        }
      }
      return out;
    }
    case "all_due": {
      for (let i = 0; i < s.cards; i++) {
        out.push({ state: "NEW", due: new Date(now.getTime() - (i + 1) * HOUR_MS), stability: 0, difficulty: 0, reps: 0, lapses: 0, scheduledDays: 0, lastReview: null });
      }
      return out;
    }
    case "next_release": {
      for (let i = 0; i < s.cards; i++) {
        out.push({ state: "NEW", due: release, stability: 0, difficulty: 0, reps: 0, lapses: 0, scheduledDays: 0, lastReview: null });
      }
      return out;
    }
  }
}

/** The local day `n` days before `today` ("YYYY-MM-DD" arithmetic, no zone involved). */
export function daysBefore(today: string, n: number): string {
  const t = Date.parse(`${today}T00:00:00.000Z`) - n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}
