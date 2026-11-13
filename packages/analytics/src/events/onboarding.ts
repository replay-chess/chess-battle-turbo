// Onboarding v3 events (phase-04 plan §10.1, §7.2; TST X6): the eight steps (client, `trackOnboarding()` in
// apps/web/lib/onboarding/telemetry.ts) and the server's `onb_completed_server` (posthog-node in `after()` of
// PATCH /api/me/onboarding {complete}). Closed property sets: no usernames, emails, FENs or free text; counts are
// bucketed; `distinct_id` is the viewer's referenceId. The checkout_* events of the plan step are billing.ts's.
import { z } from "zod";

export const ONB_STEPS = ["welcome", "link", "confirm", "level", "goals", "plan", "activating", "done"] as const;
export const ONB_SKIPPABLE_STEPS = ["link", "level", "goals"] as const;
export const ONB_PROVIDERS = ["chesscom", "lichess"] as const;
export const ONB_LOOKUP_RESULTS = ["found", "not_found", "private", "no_games", "rate_limited", "linked_elsewhere", "error"] as const;
export const ONB_LICHESS_RESULTS = ["linked", "denied", "error"] as const;
/** `access_denied` for a denial; LICHESS_ERROR_REASONS (CT p04-plain) for errors; anything else `unknown`. */
export const ONB_LICHESS_REASONS = ["access_denied", "state", "upstream", "linked_elsewhere", "already_linked", "rate_limited", "unknown"] as const;
export const ONB_GAMES_BUCKETS = ["0", "1-49", "50-499", "500+"] as const;
export const ONB_RATING_BANDS = ["new_to_chess", "under_800", "r800_1200", "r1200_1600", "r1600_2000", "r2000_plus"] as const;
export const ONB_BAND_SOURCES = ["suggested", "changed", "manual"] as const;
export const ONB_GOALS = ["stop_blundering", "learn_openings", "improve_endgames", "study_legends", "play_friends"] as const;
export const ONB_PLANS = ["monthly", "yearly"] as const;
export const ONB_DONE_CTAS = ["home", "first_position"] as const;
export const ONB_ACTIVATION_SOURCES = ["onboarding", "pricing", "paywall", "renew", "unknown"] as const;

const ms = z.number().int().min(0).max(86_400_000);
const provider = z.enum(ONB_PROVIDERS);
const step = z.enum(ONB_STEPS);
const minutes = z.union([z.literal(5), z.literal(10), z.literal(20)]);
const goals = z.array(z.enum(ONB_GOALS)).max(ONB_GOALS.length);
const providers = z.array(provider).max(ONB_PROVIDERS.length);

export const onboardingClientEvents = {
  onb_step_viewed: z.object({ step }).strict(),
  onb_step_completed: z.object({ step, ms_on_step: ms }).strict(),
  onb_step_skipped: z.object({ step: z.enum(ONB_SKIPPABLE_STEPS) }).strict(),
  onb_get_started_clicked: z.object({}).strict(),
  onb_link_lookup_submitted: z.object({ provider: z.literal("chesscom") }).strict(),
  onb_link_lookup_result: z.object({ result: z.enum(ONB_LOOKUP_RESULTS), ms, is_cache_hit: z.boolean() }).strict(),
  onb_link_lichess_clicked: z.object({}).strict(),
  onb_link_lichess_result: z.object({ result: z.enum(ONB_LICHESS_RESULTS), reason: z.enum(ONB_LICHESS_REASONS) }).strict(),
  onb_confirm_viewed: z.object({ provider, games_bucket: z.enum(ONB_GAMES_BUCKETS) }).strict(),
  onb_confirm_accepted: z.object({ provider }).strict(),
  onb_confirm_not_me: z.object({ provider }).strict(),
  onb_level_selected: z.object({ band: z.enum(ONB_RATING_BANDS), source: z.enum(ONB_BAND_SOURCES) }).strict(),
  onb_goals_changed: z.object({ goals }).strict(),
  onb_minutes_changed: z.object({ minutes }).strict(),
  onb_plan_viewed: z.object({ plan_default: z.enum(ONB_PLANS), is_trial_eligible: z.boolean() }).strict(),
  onb_plan_toggled: z.object({ plan: z.enum(ONB_PLANS) }).strict(),
  onb_activating_continue_background: z.object({ source: z.enum(ONB_ACTIVATION_SOURCES) }).strict(),
  onb_completed: z
    .object({
      total_ms: ms,
      linked_providers: providers,
      rating_band: z.enum(ONB_RATING_BANDS).nullable(),
      goals,
      daily_minutes: minutes.nullable(),
      plan: z.enum(ONB_PLANS).nullable(),
      is_trial: z.boolean(),
    })
    .strict(),
  onb_done_cta_clicked: z.object({ cta: z.enum(ONB_DONE_CTAS) }).strict(),
  onb_import_retry_clicked: z.object({ provider }).strict(),
  onb_signed_out: z.object({ step }).strict(),
} as const;

export const onboardingServerEvents = {
  onb_completed_server: z.object({ is_trial: z.boolean(), linked_providers: providers }).strict(),
} as const;

export const onboardingEvents = { ...onboardingClientEvents, ...onboardingServerEvents } as const;

export type OnboardingClientEventName = keyof typeof onboardingClientEvents;
export type OnboardingServerEventName = keyof typeof onboardingServerEvents;
export type OnboardingClientProps<N extends OnboardingClientEventName> = z.infer<(typeof onboardingClientEvents)[N]>;
export type OnboardingServerProps<N extends OnboardingServerEventName> = z.infer<(typeof onboardingServerEvents)[N]>;
