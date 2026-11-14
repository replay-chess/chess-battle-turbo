// HTTP contracts of Train and the Mistake Bank (phase-05 plan §7.1, §7.2 R1–R4, R8, W1–W6, W8, A6; §9.4 budgets).
// Registry entries live in registry/train.ts (and registry/home.ts, registry/reports.ts for HOME-1 and W7).
// Wire enums are lowercase (R-17); ids never leave the server, only refs: a card's API ref is its `itemKey`
// ("m_<sqid>", "p_<lichessId>", "o_<sqid>"), a session's and a mistake's ref is their `referenceId` (a cuid).
//
// Every time label in these payloads ("Tomorrow", "08:00", "Oct 27") is formatted on the server in the viewer's
// zone (`@repo/chess-training/labels`), so SSR and hydration agree. Solutions travel only in the session payload
// (TrainItem): BankRow is strict so a best move can never be added to the list by accident (§11 hidden information).
import { z } from "zod";
import { Color, CursorParam, FenLoose, IsoDateTime, Limit, Ref, Uci } from "./common";
import { TimeZone } from "./onboarding";

// ── Limits shared by the routes, the size tests and the clients ────────────────────────────────────────────────
/** A bank this small is sent whole on page 1 (`meta.complete = true`) and filtered on the client (§5.2 S3). */
export const BANK_COMPLETE_MAX_ROWS = 300;
/** Page size once a bank is larger (pages 2+, and page 1 of a large bank). */
export const BANK_PAGE_ROWS = 50;
/** Items a session payload may hold (≤ 20 built + Again re-queues). */
export const SESSION_MAX_ITEMS = 40;
/** Items one W3 extend appends. */
export const EXTEND_ITEMS = 10;
/** Attempts one W1 batch may carry (the outbox sends at most this many, sorted by reviewedAt). */
export const ATTEMPTS_BATCH_MAX = 50;
/** W1 body limit (§7.2): 50 attempts are ≤ 16 KB, the route allows 64 KB. */
export const ATTEMPTS_MAX_BODY_BYTES = 65_536;
/** W2 body limit. */
export const SESSION_CREATE_MAX_BODY_BYTES = 16_384;
/** Plan steps (bank, puzzles; P8 adds the lesson step). */
export const PLAN_MAX_STEPS = 3;
/** Daily fair-use cap on puzzles (TRAIN_PUZZLES_DAILY_LIMIT overrides it on the server). */
export const TRAIN_PUZZLES_DAILY_LIMIT_DEFAULT = 400;

/** `train-write` (W1, W3, W5, W6, W8): the P1 burst bucket. */
export const TRAIN_WRITE_LIMIT = { bucket: "train-write", limit: 120, windowSec: 60, by: "user" } as const;
/**
 * `train-session-burst` 20 / 60 s on W2 (FIX-1): a create that is not a reuse does real work (shard loads, exclusion
 * reads), so a burst is refused before the handler; the durable `train-session` 30 / h is counted from the rows.
 */
export const TRAIN_SESSION_BURST_LIMIT = { bucket: "train-session-burst", limit: 20, windowSec: 60, by: "user" } as const;
/**
 * `train-session` (W2 and the page-level create): 30 created sessions per hour per member. Durable, counted from
 * `training_sessions` in the reuse statement (§6.5), so the route limiter (which counts every request) is not used:
 * the handler answers 429 `rate_limited` with `details.reason: "session_limit"` and `Retry-After` (interface check §0.8).
 */
export const TRAIN_SESSION_HOURLY = { limit: 30, windowSec: 3_600 } as const;

// ── Shared ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** A local training day, `YYYY-MM-DD` (the day starts at the member's `dayStartHour`). */
export const DayKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
export type DayKey = z.infer<typeof DayKey>;

/** A card's API ref: `m_` + sqid of the mistake's epdHash, `p_` + Lichess puzzle id, `o_` + sqid of the opening id. */
export const ItemKey = z.string().regex(/^[mpo]_[A-Za-z0-9]{1,24}$/);
export type ItemKey = z.infer<typeof ItemKey>;

/** Lichess puzzle theme keys verbatim (`fork`, `backRankMate`), own-mistake patterns with the `rc:` prefix (§8.11). */
export const ThemeKey = z.string().regex(/^(rc:)?[A-Za-z0-9]{2,30}$/);
export type ThemeKey = z.infer<typeof ThemeKey>;

/** A Lichess puzzle id. */
export const PuzzleId = z.string().regex(/^[A-Za-z0-9]{5,8}$/);
export type PuzzleId = z.infer<typeof PuzzleId>;

export const GRADES = ["again", "hard", "good", "easy"] as const;
export const Grade = z.enum(GRADES);
export type Grade = z.infer<typeof Grade>;

export const ITEM_KINDS = ["mistake", "review_position", "puzzle", "opening_line"] as const;
export const ItemKind = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof ItemKind>;

export const JudgementW = z.enum(["inaccuracy", "mistake", "miss", "blunder"]);
export type JudgementW = z.infer<typeof JudgementW>;

export const PHASES_W = ["opening", "middlegame", "endgame"] as const;
export const PhaseW = z.enum(PHASES_W);
export type PhaseW = z.infer<typeof PhaseW>;

/** `own` = MistakeSource OWN_ERROR ("My blunders"), `missed` = MISSED_PUNISH ("Missed punishments"). */
export const BANK_SOURCES = ["own", "missed"] as const;
export const BankSourceW = z.enum(BANK_SOURCES);
export type BankSourceW = z.infer<typeof BankSourceW>;

/** SessionKind on the wire. `weakness` is written from P6; declared now so the enum never changes shape. */
export const SESSION_KINDS = ["daily", "bank", "puzzles", "weakness", "practice"] as const;
export const SessionKindW = z.enum(SESSION_KINDS);
export type SessionKindW = z.infer<typeof SessionKindW>;

export const SESSION_SOURCES = [
  "hub",
  "plan",
  "bank",
  "review_complete",
  "summary",
  "nav",
  "solve_one",
  "home",
  "picker",
  "deeplink",
] as const;
export const SessionSource = z.enum(SESSION_SOURCES);
export type SessionSource = z.infer<typeof SessionSource>;

export const IsoDT = IsoDateTime;

export const ThemeRef = z.object({ key: ThemeKey, label: z.string().max(40) });
export type ThemeRef = z.infer<typeof ThemeRef>;

/** "Your next 6 reviews arrive tomorrow at 08:00": the next release with due cards. */
export const NextBatch = z.object({
  at: IsoDT,
  atLabel: z.string().max(24),
  count: z.number().int().min(0),
  /** "tomorrow at 08:00" / "Saturday at 08:00", in the member's zone at the read (Home: "Next batch tomorrow at 08:00."). Optional: older builds omit it. */
  whenLabel: z.string().max(32).optional(),
});
export type NextBatch = z.infer<typeof NextBatch>;

/** One grade button's real interval ("< 10 min", "4 days"), computed on the server at build time. */
export const IntervalPreview = z.object({ label: z.string().max(12), due: IsoDT, days: z.number().min(0) });
export type IntervalPreview = z.infer<typeof IntervalPreview>;

/** The four grade previews (an exhaustive record: every grade has one). */
export const GradePreviews = z.record(Grade, IntervalPreview);
export type GradePreviews = z.infer<typeof GradePreviews>;

/** A from/to pair for last-move marks. */
export const LastMove = z.tuple([z.string().regex(/^[a-h][1-8]$/), z.string().regex(/^[a-h][1-8]$/)]);
export type LastMove = z.infer<typeof LastMove>;

/**
 * Legend lesson card slot (P8 fills it from `nextLessonForPlan(viewer)`; always null in P5, coverage C-05/C-06).
 * Frozen interface: P8 adds a component, never a field.
 */
export const LessonCard = z.object({
  slug: z.string().max(80),
  title: z.string().max(80),
  minutes: z.number().int(),
  href: z.string().startsWith("/").max(200),
});
export type LessonCard = z.infer<typeof LessonCard>;

// ── R1 GET /api/train/today ─────────────────────────────────────────────────────────────────────────────────────
export const PLAN_STEP_KINDS = ["bank", "puzzles", "lesson", "review", "import"] as const;
export const PlanStepKind = z.enum(PLAN_STEP_KINDS);
export type PlanStepKind = z.infer<typeof PlanStepKind>;

export const PlanStep = z.object({
  kind: PlanStepKind,
  title: z.string().max(80),
  subtitle: z.string().max(80),
  estMin: z.number().int().min(1).max(60),
  status: z.enum(["due", "next", "done"]),
  href: z.string().startsWith("/").max(200),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const DuePreview = z.object({
  cardRef: ItemKey,
  fen: FenLoose,
  orient: Color,
  lastMove: LastMove.nullable(),
  themeLabel: z.string().max(40),
  opponent: z.string().max(40),
  moveNo: z.number().int().min(1),
  /** The thumbnail's accessible name: "Due: loose piece vs tal_fan_77, move 19". */
  label: z.string().max(120),
});
export type DuePreview = z.infer<typeof DuePreview>;

export const TrainToday = z.object({
  dayKey: DayKey,
  /** "Thursday". */
  weekdayLabel: z.string().max(16),
  plannedMinutes: z.number().int().min(0),
  state: z.enum(["default", "nothingdue"]),
  streak: z.object({
    current: z.number().int().min(0),
    best: z.number().int().min(0),
    /** Monday → Sunday of the local week: trained that day. */
    week: z.array(z.boolean()).length(7),
    aria: z.string().max(120),
  }),
  plan: z.object({
    steps: z.array(PlanStep).max(PLAN_MAX_STEPS),
    done: z.number().int().min(0),
    total: z.number().int().min(0),
    basis: z.enum(["bank", "games20", "new"]),
    cta: z.object({ kind: z.enum(["start", "continue", "keep_going"]), label: z.string().max(60), href: z.string().nullable() }),
    footnote: z.string().max(120),
  }),
  due: z.object({
    shown: z.number().int().min(0),
    raw: z.number().int().min(0),
    capRemaining: z.number().int().min(0),
    cap: z.number().int().min(0),
    /** "6 more wait for later days. FSRS keeps it to 10 a day." */
    waitingLine: z.string().max(120).nullable(),
    preview: z.array(DuePreview).max(4),
  }),
  nextBatch: NextBatch.nullable(),
  allTraining: z.object({
    bank: z.object({ due: z.number().int().min(0), total: z.number().int().min(0) }),
    puzzles: z.object({
      themes: z.array(z.object({ key: ThemeKey, label: z.string().max(40), pct: z.number().int().min(0).max(100).nullable() })).max(3),
    }),
  }),
  mastery: z.array(z.object({ key: ThemeKey, label: z.string().max(40), pct: z.number().int().min(0).max(100) })).max(4),
  keepGoing: z.object({ href: z.string().startsWith("/").max(200), label: z.string().max(60) }).nullable(),
  puzzleRating: z.object({ value: z.number().int(), provisional: z.boolean() }),
  prefs: z.object({ timeZone: z.string().max(64), dayStartHour: z.number().int().min(0).max(23), releaseHour: z.number().int().min(0).max(23) }),
});
export type TrainToday = z.infer<typeof TrainToday>;

// ── R2 GET /api/train/bank ──────────────────────────────────────────────────────────────────────────────────────
export const BankQuery = z.object({
  view: z.enum(["due", "all"]).default("all"),
  theme: ThemeKey.optional(),
  phase: PhaseW.optional(),
  source: BankSourceW.optional(),
  cursor: CursorParam,
  limit: Limit(BANK_PAGE_ROWS, BANK_PAGE_ROWS),
});
export type BankQuery = z.infer<typeof BankQuery>;
export type BankQueryInput = z.input<typeof BankQuery>;

/** Strict: no `bestSan` / `solution` can ever be added by accident ("best move hidden until you try"). */
/**
 * One Mistake Bank row. No mistake ref: the client names a bank position by its card key (W5, W6, W7 accept it), and
 * a 25-character random ref per row was the largest single cost of the page's gzip (FIX-1 payload budgets: §9.4's
 * 50-row page ≤ 4 KB gzip holds without it).
 */
export const BankRow = z.strictObject({
  cardRef: ItemKey,
  fen: FenLoose,
  orient: Color,
  lastMove: LastMove.nullable(),
  theme: ThemeRef,
  judgement: JudgementW,
  playedSan: z.string().max(10),
  moveNo: z.number().int().min(1),
  opponent: z.string().max(40),
  /** "today", "yesterday", "Oct 27". */
  playedAtLabel: z.string().max(16),
  phase: PhaseW,
  source: BankSourceW,
  mastery: z.number().int().min(0).max(5),
  isDue: z.boolean(),
  /** "Tomorrow", "Sat", "Nov 6"; null when due. */
  nextLabel: z.string().max(16).nullable(),
  skippedToday: z.boolean(),
  occurrences: z.number().int().min(1),
  /** "See It in Your Game" → /review/{gameRef}?ply={gamePly}&from=bank. */
  gameRef: Ref,
  gamePly: z.number().int().min(0).nullable(),
});
export type BankRow = z.infer<typeof BankRow>;

export const Facet = z.object({ key: z.string().max(32), label: z.string().max(40), n: z.number().int().min(0) });
export type Facet = z.infer<typeof Facet>;

export const BankPage = z.object({
  state: z.enum(["empty", "caughtup", "default"]),
  counts: z.object({
    due: z.number().int().min(0),
    dueRaw: z.number().int().min(0),
    all: z.number().int().min(0),
    capRemaining: z.number().int().min(0),
    /** The member's daily bank cap (`training_profiles.bankDailyCap`), for "FSRS keeps it to 10 a day". Optional: older builds omit it. */
    cap: z.number().int().min(0).optional(),
  }),
  rows: z.array(BankRow).max(BANK_COMPLETE_MAX_ROWS),
  facets: z.object({ theme: z.array(Facet), phase: z.array(Facet), source: z.array(Facet) }),
  /** "Tomorrow 6 · Saturday 3 · Sunday 5 · Next week 9". */
  upcoming: z.array(z.object({ label: z.string().max(16), n: z.number().int().min(0) })).max(4),
  nextBatch: NextBatch.nullable(),
  focusTheme: ThemeRef,
  emptyCtas: z
    .object({
      lastGame: z.object({ gameRef: Ref, opponent: z.string().max(40), reviewed: z.boolean() }).nullable(),
      hasLinkedAccount: z.boolean(),
    })
    .nullable(),
  /** Caught-up lesson card slot (P8, coverage C-06); always null in P5. */
  lesson: LessonCard.nullable(),
});
export type BankPage = z.infer<typeof BankPage>;

/** Pages 2+ (a cursor was sent): rows only, no counts, facets or upcoming (api-perf AP-38). */
export const BankNextPage = z.object({ rows: z.array(BankRow).max(BANK_PAGE_ROWS) });
export type BankNextPage = z.infer<typeof BankNextPage>;

/** R2's `meta`: `complete` = every row of the bank is in this page (client filtering is exact). */
export const BankPageMeta = z.object({ nextCursor: z.string().nullable(), complete: z.boolean().optional() });
export type BankPageMeta = z.infer<typeof BankPageMeta>;

// ── W2 POST /api/train/sessions ─────────────────────────────────────────────────────────────────────────────────
export const BankFilterIn = z.strictObject({ theme: ThemeKey.optional(), phase: PhaseW.optional(), source: BankSourceW.optional() });
export type BankFilterIn = z.infer<typeof BankFilterIn>;

export const SessionCreate = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("daily"), source: SessionSource.default("plan") }),
  z.strictObject({
    kind: z.literal("bank"),
    source: SessionSource,
    filter: BankFilterIn.optional(),
    cardRefs: z.array(ItemKey).min(1).max(20).optional(),
    gameRef: Ref.optional(),
    practice: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("puzzles"),
    source: SessionSource,
    theme: ThemeKey.optional(),
    count: z.number().int().min(1).max(EXTEND_ITEMS).optional(),
  }),
  z.strictObject({ kind: z.literal("practice"), fromSessionRef: Ref }),
  // { kind: "weakness", pattern, size: 10 | 20, mix } is added by P6.
]);
export type SessionCreate = z.infer<typeof SessionCreate>;
export type SessionCreateInput = z.input<typeof SessionCreate>;

export const TrainItemText = z.object({
  hint: z.string().max(300),
  /** Puzzles' "This puzzle" look line; null for bank items. */
  look: z.string().max(300).nullable(),
  correct: z.string().max(400),
  /** The coach line when the member repeats the move they played in the game. */
  wrongGameMove: z.string().max(400).nullable(),
  /** The VERIFIED tag (deterministic explainer or P7 verified text). */
  verified: z.boolean(),
});
export type TrainItemText = z.infer<typeof TrainItemText>;

export const TrainItemContext = z.object({
  gameRef: Ref,
  gamePly: z.number().int().min(0).nullable(),
  /** "Your game vs tal_fan_77 · today · move 19". */
  gameLabel: z.string().max(120),
  playedUci: Uci,
  playedSan: z.string().max(10),
  judgement: JudgementW,
  /** "Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go." */
  costText: z.string().max(300),
});
export type TrainItemContext = z.infer<typeof TrainItemContext>;

export const TrainItem = z.object({
  /** Session-local ("i3"; "i3b" for the pass-2 copy after an Again). */
  itemId: z.string().max(8),
  kind: ItemKind,
  pass: z.union([z.literal(1), z.literal(2)]),
  cardRef: ItemKey.nullable(),
  puzzleId: PuzzleId.nullable(),
  /** Start position (puzzles: before the setup move). */
  fen: FenLoose,
  /** Puzzles: the opponent's move, auto-played after 400 ms; bank: []. */
  setup: z.array(Uci).max(1),
  lastMove: LastMove.nullable(),
  /** After the setup: user, reply, user, … (odd length). */
  solution: z.array(Uci).min(1).max(15),
  /** Alternatives accepted for the first user move. */
  accept: z.array(Uci).max(6),
  orient: Color,
  theme: ThemeRef,
  rating: z.number().int().nullable(),
  /** "vs tal_fan_77 · today · move 19" | "Lichess puzzle · matched to your rating". */
  sourceLabel: z.string().max(80),
  context: TrainItemContext.nullable(),
  text: TrainItemText,
  /** Null = a practice item (no FSRS effect). */
  preview: GradePreviews.nullable(),
  /** Labels for the pass-2 copy after an Again (computed at build: keeps ts-fsrs off the client). */
  previewAfterAgain: GradePreviews.nullable(),
  /** Optimistic concurrency for W1 (the card's reps when the payload was built). */
  cardReps: z.number().int().min(0).nullable(),
  mastery: z.number().int().min(0).max(5).nullable(),
});
export type TrainItem = z.infer<typeof TrainItem>;

export const THEME_GROUPS = ["recommended", "tactics", "material", "mates", "defence", "special", "endgames"] as const;
export const ThemeOption = z.object({
  key: ThemeKey,
  label: z.string().max(40),
  group: z.enum(THEME_GROUPS),
  /** Null = "New" (fewer than 5 attempts). */
  pct: z.number().int().min(0).max(100).nullable(),
  attempts: z.number().int().min(0),
  /** Shard puzzles near the member's rating; 0 → disabled "No puzzles at your level yet". */
  available: z.number().int().min(0),
  recommended: z.boolean(),
});
export type ThemeOption = z.infer<typeof ThemeOption>;

export const SESSION_TITLES = ["Mistake Bank", "Puzzles", "Weakness drill", "Practice"] as const;

export const PuzzleRatingState = z.object({ value: z.number(), rd: z.number(), vol: z.number(), provisional: z.boolean() });
export type PuzzleRatingState = z.infer<typeof PuzzleRatingState>;

export const SessionPayload = z.object({
  ref: Ref,
  kind: SessionKindW,
  status: z.enum(["active", "completed", "abandoned"]),
  theme: ThemeRef.nullable(),
  items: z.array(TrainItem).max(SESSION_MAX_ITEMS),
  /** The first item not graded yet (the client takes the max with its outbox). */
  resumeIndex: z.number().int().min(0),
  /** "tal_fan_77 · move 17 · Recapture first" (the queue list). */
  queueLabels: z.array(z.object({ itemId: z.string().max(8), label: z.string().max(80) })).max(SESSION_MAX_ITEMS),
  header: z.object({
    title: z.enum(SESSION_TITLES),
    solveStreak: z.number().int().min(0),
    /** Puzzles only: the Glicko state the client previews from (D-13). */
    rating: PuzzleRatingState.nullable(),
  }),
  capRemaining: z.number().int().min(0).nullable(),
  countsTowardCap: z.boolean(),
  /** Puzzles: extend while `stream && !targetCount`. */
  stream: z.boolean(),
  targetCount: z.number().int().min(1).nullable(),
  themes: z.array(ThemeOption).nullable(),
  /** "Few fork puzzles near 1512; showing 1300–1700." */
  widened: z.object({ from: z.number().int(), to: z.number().int() }).nullable(),
  /** 201 with no items instead of an error. */
  empty: z.enum(["caughtup", "cap_reached", "nothing_matches"]).nullable(),
});
export type SessionPayload = z.infer<typeof SessionPayload>;

// ── W3 extend · W4 end · R3 get ─────────────────────────────────────────────────────────────────────────────────
export const SessionRefParams = z.object({ ref: Ref });
export type SessionRefParams = z.infer<typeof SessionRefParams>;

/** `after` = the itemId of the last item the client holds; a repeat returns what was appended after it. */
export const ExtendBody = z.strictObject({ after: z.string().max(8) });
export type ExtendBody = z.infer<typeof ExtendBody>;

export const ExtendResult = z.object({ items: z.array(TrainItem).max(EXTEND_ITEMS), stream: z.boolean() });
export type ExtendResult = z.infer<typeof ExtendResult>;

export const EndBody = z.strictObject({ reason: z.enum(["done", "user", "timeout"]) });
export type EndBody = z.infer<typeof EndBody>;

export const SessionQuery = z.object({ include: z.enum(["items", "summary"]).default("items") });
export type SessionQuery = z.infer<typeof SessionQuery>;

export const GradeRow = z.object({ grade: Grade, n: z.number().int().min(0), intervalLabel: z.string().max(12) });
export type GradeRow = z.infer<typeof GradeRow>;

export const SessionSummary = z.object({
  ref: Ref,
  variant: z.enum(["default", "perfect"]),
  kind: SessionKindW,
  /** "Session summary · Mistake Bank + forks". */
  eyebrow: z.string().max(80),
  title: z.string().max(60),
  subtitle: z.string().max(200),
  stats: z.object({
    solved: z.number().int().min(0),
    total: z.number().int().min(0),
    firstTry: z.number().int().min(0),
    withHint: z.number().int().min(0),
    skipped: z.number().int().min(0),
  }),
  /** Again, Hard, Good, Easy in that order. */
  grades: z.array(GradeRow).length(4),
  themes: z.array(z.object({ key: ThemeKey, label: z.string().max(40), n: z.number().int().min(0) })).max(8),
  milestone: z.object({ kind: z.enum(["theme", "perfect", "streak"]), label: z.string().max(60) }).nullable(),
  rating: z.object({ value: z.number().int(), delta: z.number().int() }).nullable(),
  next: z.object({
    puzzles: z.object({ href: z.string().startsWith("/").max(200), note: z.string().max(120) }),
    /** Slot: P8 fills it (coverage C-05); always null in P5. */
    lesson: LessonCard.nullable(),
  }),
  /** Graded attempts the server holds (the client compares with `?n=` for "Saving…"). */
  graded: z.number().int().min(0),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

/** R3: the payload (`include=items`, the default) or the summary (`include=summary`). */
export const SessionGetResult = z.union([SessionPayload, SessionSummary]);
export type SessionGetResult = z.infer<typeof SessionGetResult>;

// ── W1 POST /api/train/attempts ─────────────────────────────────────────────────────────────────────────────────
export const AttemptIn = z
  .strictObject({
    clientAttemptId: z.uuid(),
    sessionRef: Ref.nullable(),
    itemId: z.string().max(8).nullable(),
    cardRef: ItemKey.nullable(),
    puzzleId: PuzzleId.nullable(),
    kind: ItemKind,
    solved: z.boolean(),
    firstTry: z.boolean(),
    hintsUsed: z.number().int().min(0).max(2),
    wrongMovesUci: z.array(Uci).max(10),
    solutionShown: z.boolean(),
    timeMs: z.number().int().min(0).max(3_600_000),
    grade: Grade.nullable(),
    suggestedGrade: Grade,
    cardReps: z.number().int().min(0).nullable(),
    reviewedAt: IsoDT,
    /** Older than 14 days on the device: the server answers rejected/too_old. */
    stale: z.boolean().optional(),
  })
  .refine((a) => a.cardRef !== null || (a.puzzleId !== null && a.sessionRef !== null), {
    message: "cardRef, or puzzleId with sessionRef",
  });
export type AttemptIn = z.infer<typeof AttemptIn>;

export const AttemptsBody = z.strictObject({ attempts: z.array(AttemptIn).min(1).max(ATTEMPTS_BATCH_MAX) });
export type AttemptsBody = z.infer<typeof AttemptsBody>;

export const ATTEMPT_STATUSES = ["ok", "duplicate", "conflict", "rejected"] as const;
export const ATTEMPT_REJECT_REASONS = ["too_old", "not_found", "bad_item"] as const;
export const THEME_MILESTONES = [50, 70, 90] as const;

export const AttemptOut = z.object({
  clientAttemptId: z.uuid(),
  status: z.enum(ATTEMPT_STATUSES),
  reason: z.enum(ATTEMPT_REJECT_REASONS).optional(),
  card: z
    .object({
      ref: ItemKey,
      due: IsoDT,
      dueLabel: z.string().max(16),
      mastery: z.number().int().min(0).max(5),
      reps: z.number().int().min(0),
      /** False = practice: logged, no reschedule. */
      scheduled: z.boolean(),
      requeued: z.boolean(),
    })
    .optional(),
  rating: z.object({ value: z.number().int(), delta: z.number().int(), provisional: z.boolean() }).optional(),
  solveStreak: z.number().int().min(0).optional(),
  dayStreak: z.number().int().min(0).optional(),
  theme: z
    .object({
      key: ThemeKey,
      pct: z.number().int().min(0).max(100).nullable(),
      milestone: z.union([z.literal(50), z.literal(70), z.literal(90)]).optional(),
    })
    .optional(),
});
export type AttemptOut = z.infer<typeof AttemptOut>;

export const AttemptsResult = z.object({
  results: z.array(AttemptOut).max(ATTEMPTS_BATCH_MAX),
  capRemaining: z.number().int().min(0),
  /** Bitmask of done plan steps (bit i = step i). */
  planDone: z.number().int().min(0),
  bankDue: z.number().int().min(0),
  /**
   * The member's puzzle rating after the batch, in full (Glicko-2 r, RD, volatility), when the batch rated a puzzle:
   * the runner's chip takes it as is, so its next preview starts from the server's state (D-13; FIX-1 rating-sync).
   */
  rating: PuzzleRatingState.optional(),
});
export type AttemptsResult = z.infer<typeof AttemptsResult>;

// ── W5 skip · W6 remove · W8 prefs · R4 themes · R8 badges ─────────────────────────────────────────────────────
export const CardRefParams = z.object({ ref: ItemKey });
export type CardRefParams = z.infer<typeof CardRefParams>;

export const SkipBody = z.strictObject({ sessionRef: Ref.nullable() });
export type SkipBody = z.infer<typeof SkipBody>;

/** `label` = "Tomorrow" (the next release in the viewer's zone). */
export const SkipResult = z.object({ suspendedUntil: IsoDT, label: z.string().max(16) });
export type SkipResult = z.infer<typeof SkipResult>;

/** The only writer of training prefs (consistency 10.5 a). `newPerDay ≤ bankDailyCap` is checked against the stored row. */
export const TrainPrefsPatch = z
  .strictObject({
    timeZone: TimeZone.optional(),
    dayStartHour: z.number().int().min(0).max(6).optional(),
    releaseHour: z.number().int().min(5).max(12).optional(),
    bankDailyCap: z.number().int().min(5).max(30).optional(),
    newPerDay: z.number().int().min(0).max(30).optional(),
    autoGrade: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "empty patch");
export type TrainPrefsPatch = z.infer<typeof TrainPrefsPatch>;

export const TrainPrefs = z.object({
  timeZone: z.string().max(64),
  dayStartHour: z.number().int().min(0).max(23),
  releaseHour: z.number().int().min(0).max(23),
  bankDailyCap: z.number().int().min(0),
  newPerDay: z.number().int().min(0),
  autoGrade: z.boolean(),
});
export type TrainPrefs = z.infer<typeof TrainPrefs>;

export const ThemesResult = z.object({ options: z.array(ThemeOption), rating: z.number().int() });
export type ThemesResult = z.infer<typeof ThemesResult>;

/** `GET /api/me/badges`. P6 adds weaknessReady, P10 notificationsUnread (both optional when added). */
export const Badges = z.object({ bankDue: z.number().int().min(0), trainDot: z.boolean() });
export type Badges = z.infer<typeof Badges>;

// ── Review bank fields (P3's reserved slots, filled from P5: A1 MomentDTO, A2 ReviewStatusDTO, A6, complete) ─────
/** A moment's card: MomentDTO.card (A1). Null while the game is not extracted yet, or the moment is opted out. */
export const MomentCard = z.object({ ref: ItemKey, dueLabel: z.string().max(16) });
export type MomentCard = z.infer<typeof MomentCard>;

/** A6's `card` (MomentBankResponse.card). */
export const MomentBankCard = z.object({ ref: ItemKey, dueAt: IsoDT, dueLabel: z.string().max(16) });
export type MomentBankCard = z.infer<typeof MomentBankCard>;

/** ReviewStatusDTO.bank (A2): the BANK cards that exist now for this game side's moment plies. */
export const ReviewBank = z.object({ count: z.number().int().min(0), plies: z.array(z.number().int().min(0)).max(4) });
export type ReviewBank = z.infer<typeof ReviewBank>;

/** A1's per-moment bank fields together (MomentDTO.inBank + MomentDTO.card), for the review panel's toggle. */
export const MomentBank = z.object({ inBank: z.boolean(), card: MomentCard.nullable() });
export type MomentBank = z.infer<typeof MomentBank>;
