// The stored Weakness Profile document (phase-06 plan 6.3; data-model §2.6, §9): `weakness_snapshots.metrics`,
// version 1. This is the ONE definition of its shape:
//   - the engine (@repo/chess-training/weakness, which builds it) takes its TypeScript types from here with
//     `import type` (`TRN/src/weakness/types.ts` aliases the parts it names), so no zod reaches a browser bundle;
//   - @repo/db/json (`DB/src/json/weakness.ts`) re-exports this schema and adds the writer's `buildWeaknessMetrics`
//     (throws) and the reader's `parseWeaknessMetrics` (null for a document an older or newer build wrote);
//   - the enums are the wire contract's tuples (`../http/weakness`), so a value the payload can carry and a value the
//     document can store are spelled once.
// It lives in the contracts package because that is the one package both the engine and the database package depend
// on (chess-training cannot import @repo/db; db only type-depends on chess-training).
//
// Strict objects: live fields are not stored (status is derived; progress, updating, inBank, rating, weekPlan,
// matchable, slug, lesson, seenVersion and version are added at read time), so a document carrying one is refused.
import { z } from "zod";
import {
  BAND_SOURCES,
  CLOCK_BUCKET_KEYS,
  LIST_MODES,
  OPENING_NOTES,
  PatternKey,
  ROW_UNITS,
  STRENGTH_KEYS,
  TIME_CLASSES_W,
  WEAKNESS_PHASES,
  WEAKNESS_PIECES,
  WEAKNESS_TRENDS,
} from "../http/weakness";

const Phase = z.enum(WEAKNESS_PHASES);
const Count = z.number().int().min(0);
const Rate = z.number().finite();
const Iso = z.iso.datetime();

export const WeaknessExampleDoc = z.strictObject({
  fen: z.string().min(1).max(100),
  orient: z.enum(["w", "b"]),
  mistakeRef: z.string().min(1).max(40),
});

export const WeaknessMetricsRow = z.strictObject({
  pattern: PatternKey,
  label: z.string().min(1).max(60),
  unit: z.enum(ROW_UNITS),
  you: Rate,
  band: Rate.nullable(),
  events: Count,
  /** The denominator: M (themes) or M_lt1 (time pressure). */
  moves: Count,
  gamesWith: Count,
  gamesWithLast20: Count,
  lastN: Count,
  lossYou100: Rate,
  lossBand100: Rate.nullable(),
  ratio: Rate.nullable(),
  z: Rate.nullable(),
  score: Rate,
  phaseMode: Phase.nullable(),
  /** Events per phase (opening, middlegame, endgame). */
  phaseCount: z.tuple([Count, Count, Count]),
  /** Events made with under a minute on the clock. */
  eventsLt1: Count,
  trend: z.enum(WEAKNESS_TRENDS),
  trendRecent: Rate.nullable(),
  trendPrior: Rate.nullable(),
  example: WeaknessExampleDoc.nullable(),
});

export const HeadlineClaim = z.discriminatedUnion("k", [
  z.strictObject({ k: z.literal("pattern"), key: PatternKey }),
  z.strictObject({ k: z.literal("phase"), phase: Phase }),
  z.strictObject({ k: z.literal("clock"), bucket: z.literal("lt1") }),
]);

export const WeaknessHeadlineDoc = z.strictObject({
  text: z.string().min(1).max(200),
  short: z.string().min(1).max(200),
  claims: z.array(HeadlineClaim),
});

export const ClockBucketDoc = z.strictObject({
  key: z.enum(CLOCK_BUCKET_KEYS),
  moves: Count,
  blunders: Count,
  per100: Rate.nullable(),
  band: Rate.nullable(),
});

export const OpeningRowDoc = z.strictObject({
  family: z.string().min(1).max(60),
  ecoRange: z.string().regex(/^[A-E]\d\d(–[A-E]\d\d)?$/),
  games: Count,
  points: z.number().min(0).multipleOf(0.5),
  scorePct: z.number().int().min(0).max(100),
  note: z.enum(OPENING_NOTES).nullable(),
});

export const WeaknessBreakdownDoc = z.strictObject({
  phase: z.array(z.strictObject({ phase: Phase, you: Rate.nullable(), band: Rate.nullable(), moves: Count })).length(3),
  phaseSentence: z.string().max(200),
  clock: z.strictObject({ buckets: z.array(ClockBucketDoc).length(4), sentence: z.string().max(200) }).nullable(),
  openings: z.array(OpeningRowDoc).max(4),
  strengths: z.array(z.string().min(1).max(200)).max(2),
  strengthKeys: z.array(z.enum(STRENGTH_KEYS)).max(2),
  pieces: z.array(z.strictObject({ piece: z.enum(WEAKNESS_PIECES), per100: Rate.nullable() })).length(6),
});

export const WeaknessBandDoc = z.strictObject({
  min: z.number().int(),
  max: z.number().int(),
  center: z.number().int(),
  source: z.enum(BAND_SOURCES),
  rating: z.number().int(),
  baselineBands: z.array(z.string().regex(/^\d{3,4}$/)),
});

/** weakness_snapshots.metrics, version 1 (plan 6.3 + the row fields phaseCount and eventsLt1). */
export const WeaknessMetricsV1 = z.strictObject({
  v: z.literal(1),
  scope: z.strictObject({
    timeClasses: z.array(z.enum(TIME_CLASSES_W)),
    since: Iso,
    months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    maxGames: z.number().int().min(1),
  }),
  games: z.strictObject({ inScope: Count, analysed: Count, excludedBot: Count }),
  band: WeaknessBandDoc.nullable(),
  listMode: z.enum(LIST_MODES),
  /** ≤ 5, already ranked; rank 1..3 = top, 4..5 = more. */
  rows: z.array(WeaknessMetricsRow).max(5),
  /** For the version rule (plan 8.16). */
  topKeys: z.array(PatternKey).max(3),
  preliminary: z.array(z.strictObject({ pattern: PatternKey, label: z.string().min(1).max(60), seenIn: Count, of: Count })).max(3),
  headline: WeaknessHeadlineDoc.nullable(),
  breakdown: WeaknessBreakdownDoc.nullable(),
  /** FAILED rows only. */
  failure: z.strictObject({ code: z.string().min(1).max(40), at: Iso }).nullable(),
  inputs: z.strictObject({
    watermarkEndedAt: Iso.nullable(),
    healed: Count,
    /** "v1" | "v0-synthetic" */
    baseline: z.string().min(1).max(40),
    /** e.g. "sf18-v1"; must equal the baseline's meta.profile */
    engineProfile: z.string().min(1).max(40),
  }),
});
export type WeaknessMetricsV1 = z.infer<typeof WeaknessMetricsV1>;
export type WeaknessMetricsRow = z.infer<typeof WeaknessMetricsRow>;
export type WeaknessExampleDoc = z.infer<typeof WeaknessExampleDoc>;
export type HeadlineClaim = z.infer<typeof HeadlineClaim>;
export type WeaknessHeadlineDoc = z.infer<typeof WeaknessHeadlineDoc>;
export type ClockBucketDoc = z.infer<typeof ClockBucketDoc>;
export type OpeningRowDoc = z.infer<typeof OpeningRowDoc>;
export type WeaknessBreakdownDoc = z.infer<typeof WeaknessBreakdownDoc>;
export type WeaknessBandDoc = z.infer<typeof WeaknessBandDoc>;
