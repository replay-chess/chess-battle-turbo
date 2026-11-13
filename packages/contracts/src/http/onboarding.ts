// Onboarding v3 contracts (phase-04 plan §7.1, §7.2 ME-4, §8.1; D4-15, D4-16, D4-25). Wire enums are lowercase;
// the database keeps the uppercase Postgres enums (`OnboardingStep`, `RatingBand`, `OnboardingGoal`) and the
// handlers map with toWire() / fromWire() (re-exported from ./p04-plain). Client components that only need the
// lists import ./p04-plain, not this module.
import { z } from "zod";
import { IsoDateTime } from "./common";
import {
  DAILY_MINUTES,
  ONBOARDING_GOALS,
  ONBOARDING_STEPS,
  RATING_BANDS,
  RATING_BAND_SOURCE_RE,
} from "./p04-plain";

export {
  DAILY_MINUTES,
  ONBOARDING_GOALS,
  ONBOARDING_STEPS,
  ONBOARDING_STEPS_DB,
  RATING_BANDS,
  RATING_BAND_SOURCE_RE,
  fromWire,
  toWire,
  type DailyMinutes,
  type OnboardingGoalDb,
  type OnboardingGoalWire,
  type OnboardingStepDb,
  type OnboardingStepWire,
  type RatingBandDb,
  type RatingBandWire,
} from "./p04-plain";

// ── Time zone (R-03: users."timeZone", first writer the onboarding PATCH) ──────────────────────────────────────
// Checked by asking the runtime's ICU for the zone (a RangeError means unknown). Not `Intl.supportedValuesOf`: that
// lists canonical names only, and a browser may report a valid alias ("Asia/Calcutta" vs "Asia/Kolkata"); Postgres
// knows both.
const zoneCache = new Map<string, boolean>();
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/;

export function isKnownTimeZone(tz: string): boolean {
  if (tz === "UTC") return true;
  if (tz.length > 64 || !ZONE_NAME.test(tz)) return false;
  let known = zoneCache.get(tz);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      known = true;
    } catch {
      known = false;
    }
    if (zoneCache.size < 1_000) zoneCache.set(tz, known);
  }
  return known;
}

/** An IANA zone name the runtime knows ("Asia/Kolkata"), or "UTC". */
export const TimeZone = z.string().min(1).max(64).refine(isKnownTimeZone, "unknown time zone");
export type TimeZone = z.infer<typeof TimeZone>;

// ── Enums ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const OnboardingStep = z.enum(ONBOARDING_STEPS);
export type OnboardingStep = z.infer<typeof OnboardingStep>;

export const RatingBand = z.enum(RATING_BANDS);
export type RatingBand = z.infer<typeof RatingBand>;

export const Goal = z.enum(ONBOARDING_GOALS);
export type Goal = z.infer<typeof Goal>;

export const RatingBandSource = z.string().max(24).regex(RATING_BAND_SOURCE_RE);
export type RatingBandSource = z.infer<typeof RatingBandSource>;

export const DailyMinutesSchema = z.union(DAILY_MINUTES.map((m) => z.literal(m)) as [z.ZodLiteral<5>, z.ZodLiteral<10>, z.ZodLiteral<20>]);

/** The steps a PATCH may name (`done` is reached only through `complete: true`). */
export const PatchableStep = OnboardingStep.exclude(["done"]);

// ── ME-4 `PATCH /api/me/onboarding` ─────────────────────────────────────────────────────────────────────────────
/**
 * Every field optional; the step is monotonic on the server (it never moves backwards), so a retried or reordered
 * PATCH is harmless. `complete: true` needs DB entitlement (else 409 `plan_required`) and cannot carry a step.
 */
export const PatchOnboardingBody = z
  .strictObject({
    step: PatchableStep.optional(),
    ratingBand: RatingBand.nullable().optional(),
    ratingBandSource: RatingBandSource.optional(),
    initialRating: z.int().min(100).max(3000).optional(),
    goals: z
      .array(Goal)
      .max(ONBOARDING_GOALS.length)
      .refine((g) => new Set(g).size === g.length, "duplicate goal")
      .optional(),
    dailyMinutes: DailyMinutesSchema.optional(),
    timeZone: TimeZone.optional(),
    complete: z.literal(true).optional(),
  })
  .refine((b) => !(b.complete && b.step), "step and complete are exclusive");
export type PatchOnboardingBody = z.infer<typeof PatchOnboardingBody>;

/** The onboarding state of the viewer (`/api/me` `onboarding`, the PATCH response, `LinkData.onboarding`). */
export const OnboardingView = z.object({
  step: OnboardingStep,
  done: z.boolean(),
  ratingBand: RatingBand.nullable(),
  ratingBandSource: z.string().max(24).nullable(),
  initialRating: z.int().nullable(),
  goals: z.array(Goal),
  dailyMinutes: DailyMinutesSchema.nullable(),
  onboardedAt: IsoDateTime.nullable(),
});
export type OnboardingView = z.infer<typeof OnboardingView>;

/** ME-4 response: the state after the write, plus the stored zone (the client patches `qk.me().user.timeZone`). */
export const PatchOnboardingData = z.object({ onboarding: OnboardingView, timeZone: z.string().max(64) });
export type PatchOnboardingData = z.infer<typeof PatchOnboardingData>;
