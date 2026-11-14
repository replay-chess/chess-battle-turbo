// The FSRS scheduler behind one wrapper (phase-05 plan §8.2, owner decisions D-7, D-8): `ts-fsrs` 5.4.2 is imported
// here and nowhere else in the package, so a version change is one file plus the golden tests. Server-only (the web
// routes, the worker, the seeds): the browser never imports this module; grade previews, including the after-Again
// ones, travel precomputed in the session payload.
//
// Configuration: retention 0.9, maximum interval 180 days, fuzz on, short-term on, initial stabilities Hard 2 / Good
// 4 / Easy 9 days (w[1..3]), and the again-only learning-step strategy: only Again uses a step (10 min); Hard, Good
// and Easy graduate a new card straight to review ("Again < 10 min · Hard 2 days · Good 4 days · Easy 9 days").
// Golden values (fuzz off, measured with ts-fsrs 5.4.2) live in fsrs.test.ts.
//
// Dates: every interval of a day or more is snapped to the member's local release hour (`release.ts`); sub-day steps
// are not. Every function takes `now` (offline replays pass `now = reviewedAt`).
//
// Days (FIX-2, P5-FX-15): ts-fsrs counts a review's elapsed days in UTC calendar days. For a member in the Americas
// UTC midnight falls in the evening, so a session built at 23:55Z and graded at 00:05Z showed one interval and
// scheduled another. The wrapper runs ts-fsrs on the member's TRAINING-DAY clock instead (`dayClock`: the local wall
// time less `dayStartHour`, read as UTC), so elapsed days count training days (§8.4) and the preview built in a
// training day is exactly what a grade in that day does. Intervals are then measured from the real `now`.
import {
  createEmptyCard,
  default_w,
  fsrs,
  generatorParameters,
  Rating,
  State,
  StrategyMode,
  type Card,
  type FSRS,
  type FSRSParameters,
  type Grade as FsrsGrade,
  type TLearningStepsStrategy,
  type TSeedStrategy,
} from "ts-fsrs";
import { AGAIN_STEP_MINUTES, DEFAULT_DAY_START_HOUR, DEFAULT_RELEASE_HOUR } from "./constants";
import type { GradePreviews, IntervalPreview } from "@repo/contracts/http/train";
import type { GradeKey } from "./grade";
import { intervalLabel } from "./labels";
import { masteryOf, type CardState } from "./mastery";
import { snapDue } from "./release";
import { tzOffsetMs } from "./tz";

/** w with the initial stabilities Hard/Good/Easy raised to 2/4/9 days (w[0], Again, stays 0.212). */
export const W: readonly number[] = Object.freeze(default_w.map((w, i) => (i === 1 ? 2.0 : i === 2 ? 4.0 : i === 3 ? 9.0 : w)));

const BASE: Partial<FSRSParameters> = {
  request_retention: 0.9,
  maximum_interval: 180,
  enable_short_term: true,
  learning_steps: [`${AGAIN_STEP_MINUTES}m`],
  relearning_steps: [`${AGAIN_STEP_MINUTES}m`],
  w: W,
};

export const PARAMS: FSRSParameters = generatorParameters({ ...BASE, enable_fuzz: true });
export const MAXIMUM_INTERVAL = PARAMS.maximum_interval;

/** Only Again uses a learning step; Hard/Good/Easy graduate a new card ("Hard 2 days" on the board, D-8). */
export const againOnlySteps: TLearningStepsStrategy = () => ({ [Rating.Again]: { scheduled_minutes: AGAIN_STEP_MINUTES, next_step: 0 } });

export type StepsMode = "again-only" | "default-steps";

/** The card property the fuzz seed reads (`CardRow.fuzzKey`, the card's item key). */
const FUZZ_KEY = "fuzz_key";

/**
 * The fuzz seed: the card's key and its state BEFORE the grade (reps, difficulty, stability), never the review time.
 * ts-fsrs's default seed mixes in the review instant, so the interval a grade button showed when the session was built
 * and the one the server scheduled seconds later differed in most reviews ("Good 2026-11-30" became 11-28; FIX-1
 * fuzz). With this seed the same card in the same state always gets the same fuzz, so the preview is what the grade
 * does; different cards still spread.
 */
export const fuzzSeed: TSeedStrategy = function seed(this) {
  const last = Reflect.get(this, "last") as Card & { [FUZZ_KEY]?: string };
  return `${last[FUZZ_KEY] ?? ""}|${last.reps}|${last.difficulty}|${last.stability}`;
};

/**
 * A scheduler. Production uses fuzz on with the again-only strategy. `default-steps` is D-8's fallback (ts-fsrs's
 * own strategy with one 10 min step: Hard shows "15 min" on a new card); `fuzz: false` gives the golden values.
 */
export function createScheduler(opts: { fuzz?: boolean; steps?: StepsMode } = {}): FSRS {
  const f = fsrs(generatorParameters({ ...BASE, enable_fuzz: opts.fuzz ?? true })).useStrategy(StrategyMode.SEED, fuzzSeed);
  return (opts.steps ?? "again-only") === "again-only" ? f.useStrategy(StrategyMode.LEARNING_STEPS, againOnlySteps) : f;
}

export const scheduler: FSRS = createScheduler();

// ── Card ↔ row ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A `training_cards` row's FSRS columns (camelCase, the Prisma names). */
export interface CardRow {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: Date | null;
  /** The card's item key, the fuzz seed's identity (not a column; previews and grades of one card agree). */
  fuzzKey?: string;
}

/** Scheduling preferences (`TrainingProfile.releaseHour`, `.dayStartHour`, `User.timeZone`). */
export interface SchedulePrefs {
  timeZone: string;
  releaseHour?: number;
  /** The training day's rollover hour (default 4): elapsed days count these days. */
  dayStartHour?: number;
}

const HOUR_MS = 3_600_000;

/** `t` on the member's training-day clock: the local wall time less `dayStartHour`, read as UTC (see "Days" above). */
export function dayClock(t: Date, prefs: SchedulePrefs): Date {
  return new Date(t.getTime() + tzOffsetMs(t, prefs.timeZone) - (prefs.dayStartHour ?? DEFAULT_DAY_START_HOUR) * HOUR_MS);
}

/** `card` with its instants on the training-day clock (ts-fsrs's input). */
function onDayClock(card: Card, prefs: SchedulePrefs): Card {
  return { ...card, due: dayClock(card.due, prefs), ...(card.last_review ? { last_review: dayClock(card.last_review, prefs) } : {}) };
}

/** ts-fsrs's answer back on real time: the due at the same distance from the real `now`, reviewed at `now`. */
function offDayClock(next: Card, clockNow: Date, now: Date): Card {
  return { ...next, due: new Date(now.getTime() + (next.due.getTime() - clockNow.getTime())), last_review: now };
}

/** One grade of `card` at `now`, on the training-day clock. */
function nextOf(sched: FSRS, card: CardRow, now: Date, rating: FsrsGrade, prefs: SchedulePrefs): Card {
  const clockNow = dayClock(now, prefs);
  return offDayClock(sched.next(onDayClock(toFsrsCard(card), prefs), clockNow, rating).card, clockNow, now);
}

const STATE_OF: Record<CardState, State> = { NEW: State.New, LEARNING: State.Learning, REVIEW: State.Review, RELEARNING: State.Relearning };
const STATE_NAME: Record<State, CardState> = {
  [State.New]: "NEW",
  [State.Learning]: "LEARNING",
  [State.Review]: "REVIEW",
  [State.Relearning]: "RELEARNING",
};
const RATING_OF: Record<GradeKey, FsrsGrade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

export function toFsrsCard(row: CardRow): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: STATE_OF[row.state],
    ...(row.lastReview ? { last_review: row.lastReview } : {}),
    ...(row.fuzzKey ? { [FUZZ_KEY]: row.fuzzKey } : {}),
  };
}

export function fromFsrsCard(card: Card): CardRow {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_NAME[card.state],
    lastReview: card.last_review ?? null,
  };
}

/** `row` with the fuzz identity of `from` (a graded card keeps its key). */
function withKey(row: CardRow, from: Pick<CardRow, "fuzzKey">): CardRow {
  return from.fuzzKey ? { ...row, fuzzKey: from.fuzzKey } : row;
}

/** A NEW card due at `due` (BANK cards: the next release, §8.4; PUZZLE cards: now). */
export function newCardRow(due: Date): CardRow {
  return fromFsrsCard({ ...createEmptyCard(due), due });
}

// ── Previews and scheduling ────────────────────────────────────────────────────────────────────────────────────

/**
 * One grade button's real interval and the four of an item: the contract's types (`@repo/contracts/http/train`, the
 * one source). `due` is an ISO instant, snapped to the release hour when the interval is a day or more; `days` counts
 * from `now` (whole days for a day or more, a fraction for a learning step).
 */
export type { GradePreviews, IntervalPreview };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function intervalDays(next: Card, now: Date): number {
  if (next.scheduled_days >= 1) return next.scheduled_days;
  return Math.round(((next.due.getTime() - now.getTime()) / DAY_MS) * 10_000) / 10_000;
}

/**
 * ts-fsrs clamps each interval to `maximum_interval`, then forces Good > Hard and Easy > Good by a day, which can push
 * Good/Easy one or two days past the cap (measured: 182 days). The wrapper enforces the cap after that step.
 */
function capped(next: Card, now: Date): Card {
  if (next.scheduled_days <= MAXIMUM_INTERVAL) return next;
  return { ...next, scheduled_days: MAXIMUM_INTERVAL, due: new Date(now.getTime() + MAXIMUM_INTERVAL * DAY_MS) };
}

function previewOf(raw: Card, now: Date, prefs: SchedulePrefs): IntervalPreview {
  const next = capped(raw, now);
  const days = intervalDays(next, now);
  const due = snapDue(next.due, next.scheduled_days, prefs.timeZone, prefs.releaseHour ?? DEFAULT_RELEASE_HOUR);
  return { label: intervalLabel(days), due: due.toISOString(), days };
}

/** The four grade buttons for `card` graded at `now`: label, snapped due and days for each (§8.2). */
export function previewAll(card: CardRow, now: Date, prefs: SchedulePrefs, sched: FSRS = scheduler): GradePreviews {
  const clockNow = dayClock(now, prefs);
  const r = sched.repeat(onDayClock(toFsrsCard(card), prefs), clockNow);
  const at = (g: FsrsGrade) => previewOf(offDayClock(r[g].card, clockNow, now), now, prefs);
  return { again: at(Rating.Again), hard: at(Rating.Hard), good: at(Rating.Good), easy: at(Rating.Easy) };
}

/**
 * The previews the pass-2 copy shows after an Again (§7.3 W2 step 4): the card as Again leaves it, graded again at
 * `now + 10 min`. Computed when the session is built, so the client never needs ts-fsrs.
 */
export function previewAfterAgain(card: CardRow, now: Date, prefs: SchedulePrefs, sched: FSRS = scheduler): GradePreviews {
  const afterAgain = nextOf(sched, card, now, Rating.Again, prefs);
  return previewAll(withKey(fromFsrsCard(afterAgain), card), new Date(now.getTime() + AGAIN_STEP_MINUTES * MINUTE_MS), prefs, sched);
}

/** The result of grading a card (`scheduleCard`): the new row (due snapped), the unsnapped due and the review log. */
export interface Scheduled {
  card: CardRow;
  /** The due date FSRS computed, before release snapping. */
  dueRaw: Date;
  /** 0–5 dots from the new state and stability (§8.8). */
  mastery: number;
  /** `training_attempts."scheduledDays"` (whole days; 0 for a learning step). */
  scheduledDays: number;
  /** The FSRS state the card was in before this grade (the review log's state). */
  stateBefore: CardState;
}

/** Grades `card` at `now` and snaps the next due to the release hour when the interval is a day or more. */
export function scheduleCard(card: CardRow, grade: GradeKey, now: Date, prefs: SchedulePrefs, sched: FSRS = scheduler): Scheduled {
  const next = capped(nextOf(sched, card, now, RATING_OF[grade], prefs), now);
  const row = withKey(fromFsrsCard(next), card);
  const due = snapDue(next.due, next.scheduled_days, prefs.timeZone, prefs.releaseHour ?? DEFAULT_RELEASE_HOUR);
  return {
    card: { ...row, due },
    dueRaw: next.due,
    mastery: masteryOf(row.state, row.stability),
    scheduledDays: next.scheduled_days,
    stateBefore: card.state,
  };
}

/** Probability of recall at `now` (0–1); the due queue sorts by it ascending, most forgotten first (§8.6). */
export function retrievability(card: CardRow, now: Date, sched: FSRS = scheduler): number {
  if (card.state === "NEW") return 0;
  return sched.get_retrievability(toFsrsCard(card), now, false);
}
