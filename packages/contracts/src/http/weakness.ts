// HTTP contracts of the Weakness Profile (phase-06 plan §7.1, §7.2; interface check §3). Registry entries live in
// registry/train.ts (`train.weakness.get` TR-5, `train.weakness.recompute` TR-12, `train.weakness.seen` TR-13); the
// drill start is P5's `train.sessions.create` with the `weakness` member of `SessionCreate` (./train.ts).
//
// The payload is built by the pure `buildPayload()` in @repo/chess-training/weakness/payload from the stored
// snapshot (`weakness_snapshots.metrics`, WeaknessMetricsV1) plus the live reads (bank counts, the progress probe,
// the training profile). Every label is formatted on the server, so the client renders strings and numbers only.
// ≤ 8 KB raw / ≤ 3 KB gzip (plan §9.3): ≤ 5 rows, FEN strings only, no PGN.
//
// Client code must not parse with these schemas in production builds (interface check §0.18): it writes
// `process.env.NODE_ENV === "production" ? undefined : WeaknessPayload` at the call site.
import { z } from "zod";
import { IsoDateTime } from "./common";

// ── Limits shared by the routes, the size tests and the clients ────────────────────────────────────────────────
/** TR-5 budget (plan §9.3): `JSON.stringify(payload).length` stays below this, with and without legend lessons. */
export const WEAKNESS_PAYLOAD_MAX_BYTES = 8_192;
/** TR-12 body limit (413 `payload_too_large` above it). */
export const RECOMPUTE_MAX_BODY_BYTES = 1_024;
/** TR-13 body limit. */
export const SEEN_MAX_BODY_BYTES = 256;
/**
 * TR-12 burst bucket in front of the handler (P1 fixed window). The real limit, 1 recompute per 600 s per member, is
 * durable: it is read from the member's own job row (`payload.userAt`) inside the enqueue statement, so it survives
 * Neon's scale-to-zero (plan §7.1.2, AP-11), and the handler answers 429 `rate_limited` with `Retry-After`.
 */
export const WEAKNESS_RECOMPUTE_BURST_LIMIT = { bucket: "weakness-recompute-burst", limit: 5, windowSec: 60, by: "user" } as const;
/** The durable TR-12 window (seconds). */
export const WEAKNESS_RECOMPUTE_WINDOW_SEC = 600;
/** Full profile threshold and the preliminary list's start (plan §8.1 GAMES_REQUIRED, PRELIMINARY_FROM). */
export const WEAKNESS_GAMES_REQUIRED = 20;
export const WEAKNESS_PRELIMINARY_FROM = 5;
/** Most games a scope reads (plan §8.2). */
export const WEAKNESS_MAX_GAMES = 300;

// ── Enums ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Time classes a weakness scope may hold (DB spelling). DAILY and UNTIMED are never offered in P6. */
export const TIME_CLASSES_W = ["BULLET", "BLITZ", "RAPID", "CLASSICAL"] as const;
export const TimeClassW = z.enum(TIME_CLASSES_W);
export type TimeClassW = z.infer<typeof TimeClassW>;

export const WEAKNESS_STATUSES = ["insufficient", "computing", "ready", "failed"] as const;
export const WeaknessStatus = z.enum(WEAKNESS_STATUSES);
export type WeaknessStatus = z.infer<typeof WeaknessStatus>;

/** A taxonomy key that can be a weakness row: "fork", "hangingPiece", "rc:timePressure". */
export const PatternKey = z.string().regex(/^(rc:)?[a-z][A-Za-z0-9]{1,31}$/);
export type PatternKey = z.infer<typeof PatternKey>;
/** The URL form of a pattern key (`/train/weakness/[pattern]`): "fork", "hanging-piece", "time-pressure". */
export const PatternSlug = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export type PatternSlug = z.infer<typeof PatternSlug>;

export const PROGRESS_STEP_KEYS = ["import", "grade", "patterns", "compare"] as const;
export const ProgressStepKey = z.enum(PROGRESS_STEP_KEYS);
export type ProgressStepKey = z.infer<typeof ProgressStepKey>;

export const WEAKNESS_PHASES = ["opening", "middlegame", "endgame"] as const;
const Phase = z.enum(WEAKNESS_PHASES);
export const CLOCK_BUCKET_KEYS = ["gt5", "2to5", "1to2", "lt1"] as const;
export const ClockBucketKey = z.enum(CLOCK_BUCKET_KEYS);
export const WEAKNESS_TRENDS = ["worse", "same", "better", "unknown"] as const;
export const LIST_MODES = ["vs_band", "own_only", "most_frequent"] as const;
export const BAND_SOURCES = ["lichess", "chesscom", "replay", "onboarding"] as const;
export const OPENING_NOTES = ["most_played", "most_points_lost", "best_score"] as const;
/** A row's rate unit: per 100 moves, or (the time-pressure row) per 100 moves made with under a minute left. */
export const ROW_UNITS = ["per100", "per100_under1min"] as const;
/** The strength sentences the breakdown may carry (plan §8.9). */
export const STRENGTH_KEYS = ["conversion", "book_exit_w", "book_exit_b", "phase_opening", "phase_middlegame", "phase_endgame"] as const;
/** The moved piece of the breakdown's piece rates (STATS_V1 slots 15–26 order). */
export const WEAKNESS_PIECES = ["p", "n", "b", "r", "q", "k"] as const;
export const WEEK_PLAN_KINDS = ["drill", "puzzles", "lesson"] as const;

/** A legend lesson slot (P8 lights it up through `resolveLessonForPattern`; always null in P6, plan §7.6). */
export const WeaknessLesson = z.strictObject({ slug: z.string().max(80), title: z.string().max(80), sub: z.string().max(100) });
export type WeaknessLesson = z.infer<typeof WeaknessLesson>;

// ── Payload parts ──────────────────────────────────────────────────────────────────────────────────────────────
export const WeaknessProgress = z.strictObject({
  pct: z.number().int().min(0).max(100),
  etaSec: z.number().int().min(0).max(86_400).nullable(),
  stalled: z.boolean(),
  /** ≥ 5 analysed in scope, no snapshot, no recompute job: the page sends one auto-build POST (plan §8.14). */
  orphaned: z.boolean(),
  analysed: z.number().int().min(0),
  target: z.number().int().min(1).max(300),
  steps: z
    .array(
      z.strictObject({
        key: ProgressStepKey,
        label: z.string().max(80),
        pct: z.number().int().min(0).max(100),
        state: z.enum(["done", "run", "wait"]),
      }),
    )
    .length(4),
});
export type WeaknessProgress = z.infer<typeof WeaknessProgress>;

export const WeaknessExample = z.strictObject({ fen: z.string().max(100), orient: z.enum(["w", "b"]), mistakeRef: z.string().max(32) });
export type WeaknessExample = z.infer<typeof WeaknessExample>;

export const WeaknessRow = z.strictObject({
  rank: z.number().int().min(1).max(5),
  pattern: PatternKey,
  slug: PatternSlug,
  label: z.string().max(40),
  unit: z.enum(ROW_UNITS),
  /** One decimal. */
  you: z.number().min(0).max(100),
  band: z.number().min(0).max(100).nullable(),
  trend: z.enum(WEAKNESS_TRENDS),
  /** "Getting worse this month", "About the same", "Improving", "Not enough recent games for a trend". */
  trendLabel: z.string().max(60),
  events: z.number().int().min(0),
  /** "Middlegame · 7 of the last 20 games". */
  where: z.string().max(80),
  example: WeaknessExample.nullable(),
  inBank: z.number().int().min(0),
  /** The pattern has matched Lichess puzzles (the drill's mix checkbox). */
  matchable: z.boolean(),
  lesson: WeaknessLesson.nullable(),
});
export type WeaknessRow = z.infer<typeof WeaknessRow>;

export const WeaknessPreliminary = z.strictObject({
  pattern: PatternKey,
  label: z.string().max(40),
  seenIn: z.number().int().min(0),
  of: z.number().int().min(0),
});
export type WeaknessPreliminary = z.infer<typeof WeaknessPreliminary>;

export const WeekPlanRow = z.strictObject({
  kind: z.enum(WEEK_PLAN_KINDS),
  label: z.string().max(60),
  sub: z.string().max(100),
  href: z.string().startsWith("/").max(120),
});
export type WeekPlanRow = z.infer<typeof WeekPlanRow>;

export const WeaknessBreakdown = z.strictObject({
  phase: z.strictObject({
    sentence: z.string().max(160),
    rows: z
      .array(
        z.strictObject({
          phase: Phase,
          label: z.string().max(20),
          you: z.number().int().nullable(),
          band: z.number().int().nullable(),
        }),
      )
      .length(3),
  }),
  clock: z
    .strictObject({
      sentence: z.string().max(160),
      ariaLabel: z.string().max(200),
      buckets: z
        .array(
          z.strictObject({
            key: ClockBucketKey,
            label: z.string().max(20),
            per100: z.number().nullable(),
            moves: z.number().int(),
          }),
        )
        .length(4),
    })
    .nullable(),
  openings: z
    .array(
      z.strictObject({
        family: z.string().max(60),
        ecoRange: z.string().max(16),
        games: z.number().int(),
        scorePct: z.number().int().min(0).max(100),
        note: z.enum(OPENING_NOTES).nullable(),
      }),
    )
    .max(4),
  strengths: z.array(z.string().max(160)).max(2),
});
export type WeaknessBreakdown = z.infer<typeof WeaknessBreakdown>;

// ── TR-5 GET /api/train/weakness ───────────────────────────────────────────────────────────────────────────────
export const WeaknessPayload = z.strictObject({
  v: z.literal(1),
  status: WeaknessStatus,
  scope: z.strictObject({
    timeClasses: z.array(TimeClassW).min(1),
    since: IsoDateTime,
    months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    maxGames: z.literal(WEAKNESS_MAX_GAMES),
  }),
  /** "212 games · rapid and blitz · since Aug 2026" (ready) | "Rapid and blitz · since Aug 2026". */
  scopeLabel: z.string().max(80),
  /** "212 games · since Aug 2026". */
  scopeLabelShort: z.string().max(60),
  games: z.strictObject({
    analysed: z.number().int(),
    inScope: z.number().int(),
    pending: z.number().int(),
    required: z.literal(WEAKNESS_GAMES_REQUIRED),
    preliminaryFrom: z.literal(WEAKNESS_PRELIMINARY_FROM),
  }),
  progress: WeaknessProgress.nullable(),
  updating: z.strictObject({ newGames: z.number().int().min(0) }).nullable(),
  band: z
    .strictObject({
      min: z.number().int(),
      max: z.number().int(),
      label: z.string().max(20),
      source: z.enum(BAND_SOURCES),
    })
    .nullable(),
  /** The puzzle rating near which matched puzzles are drawn. */
  rating: z.number().int().nullable(),
  headline: z.strictObject({ text: z.string().max(200), short: z.string().max(120), verified: z.literal(true) }).nullable(),
  listMode: z.enum(LIST_MODES),
  top: z.array(WeaknessRow).max(3),
  more: z.array(WeaknessRow).max(2),
  preliminary: z.array(WeaknessPreliminary).max(3),
  weekPlan: z.array(WeekPlanRow).max(3),
  breakdown: WeaknessBreakdown.nullable(),
  offers: z.strictObject({ includeBullet: z.strictObject({ bulletGames: z.number().int() }).nullable() }),
  failure: z.strictObject({ code: z.string().max(40), retryable: z.boolean() }).nullable(),
  version: z.number().int(),
  seenVersion: z.number().int(),
  algoVersion: z.number().int(),
  computedAt: IsoDateTime.nullable(),
  /** `{weekStart}.{computedAt epoch ms base36}`, or null without a snapshot. */
  snapshotKey: z.string().max(40).nullable(),
});
export type WeaknessPayload = z.infer<typeof WeaknessPayload>;

// ── TR-12 POST /api/train/weakness/recompute ───────────────────────────────────────────────────────────────────
export const RecomputeBody = z.strictObject({
  timeClasses: z
    .array(TimeClassW)
    .min(1)
    .max(4)
    .refine((a) => new Set(a).size === a.length, "duplicate time class")
    .optional(),
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
});
export type RecomputeBody = z.infer<typeof RecomputeBody>;

export const RecomputeResponse = z.strictObject({ status: z.literal("computing"), queuedAt: IsoDateTime, scopeChanged: z.boolean() });
export type RecomputeResponse = z.infer<typeof RecomputeResponse>;

// ── TR-13 POST /api/train/weakness/seen ────────────────────────────────────────────────────────────────────────
export const SeenBody = z.strictObject({ version: z.number().int().min(0).max(2_147_483_647) });
export type SeenBody = z.infer<typeof SeenBody>;
