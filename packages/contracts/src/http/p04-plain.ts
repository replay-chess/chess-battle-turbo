// The zod-free half of the P4 HTTP contracts (phase-04 plan §7.1, §8.1, §8.11; api-perf AP-12): constants and pure
// mappers that both server code and client chunks need (the Link step's username check, the onboarding wire enums,
// the view-status names). The schema modules (accounts.ts, import.ts, onboarding.ts) build their zod enums from
// these lists and re-export them, so server code may import either; client components import
// `@repo/contracts/http/p04-plain` directly so no zod reaches their first load. This module imports nothing
// (p04-contracts.test.ts scans its source).

// ── Providers ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Wire spelling of `ChessProvider` (DB `CHESSCOM` | `LICHESS`). */
export const PROVIDER_SLUGS = ["chesscom", "lichess"] as const;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];
export type ProviderDb = "CHESSCOM" | "LICHESS";

export function providerToDb(slug: ProviderSlug): ProviderDb {
  return slug === "chesscom" ? "CHESSCOM" : "LICHESS";
}

export function providerFromDb(value: ProviderDb): ProviderSlug {
  return value === "CHESSCOM" ? "chesscom" : "lichess";
}

/** Rating pools a linked account reports (`RatingsV1` keys). Lichess ultraBullet folds into bullet, correspondence into daily. */
export const TIME_CLASS_SLUGS = ["bullet", "blitz", "rapid", "classical", "daily"] as const;
export type TimeClassSlug = (typeof TIME_CLASS_SLUGS)[number];

/** Chess.com handles: 3–25 letters, digits, `-` or `_` (checked on the client before a lookup is sent). */
export const CHESSCOM_USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;
export const CHESSCOM_USERNAME_MESSAGE = "Chess.com usernames are 3–25 letters, digits, - or _.";

/** What the server does to a typed handle before the regex: trim, then drop one leading `@`. */
export function normaliseChessComUsername(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

export function isChessComUsername(raw: string): boolean {
  return CHESSCOM_USERNAME_RE.test(normaliseChessComUsername(raw));
}

// ── Import runs and the link view status (§8.11) ────────────────────────────────────────────────────────────────
export const IMPORT_TRIGGERS = ["initial", "manual", "daily", "retry"] as const;
export type ImportTriggerWire = (typeof IMPORT_TRIGGERS)[number];

export const IMPORT_RUN_STATUSES = ["waiting_for_membership", "queued", "running", "done", "failed", "cancelled"] as const;
export type ImportRunStatusWire = (typeof IMPORT_RUN_STATUSES)[number];
/** Run statuses that hold the `import_runs_one_active` slot. */
export const ACTIVE_IMPORT_RUN_STATUSES = ["waiting_for_membership", "queued", "running"] as const satisfies readonly ImportRunStatusWire[];

/** D4-18: a run first reads (fetch + parse the window), then saves newest first. */
export const IMPORT_PHASES = ["reading", "saving"] as const;
export type ImportPhase = (typeof IMPORT_PHASES)[number];

/** `ImportErrorV1.code` (`token_revoked` was dropped with D4-21). */
export const IMPORT_ERROR_CODES = ["not_found", "closed", "upstream", "timeout", "rate_limited", "internal"] as const;
export type ImportErrorCodeWire = (typeof IMPORT_ERROR_CODES)[number];

/** What `/settings/connected` renders per account (one value derived from LinkStatus × ImportState, §8.11). */
export const LINK_VIEW_STATUSES = ["linked", "waiting_for_membership", "queued", "syncing", "rate_limited", "error"] as const;
export type LinkViewStatus = (typeof LINK_VIEW_STATUSES)[number];

/** `?returnTo=` of `GET /api/accounts/lichess/start` (an allow-list, never a free URL). */
export const LICHESS_RETURN_PATHS = ["/onboarding/link", "/settings/connected"] as const;
export type LichessReturnPath = (typeof LICHESS_RETURN_PATHS)[number];

/** `?lichess=` on the return page after the OAuth callback. */
export const LICHESS_RETURN_STATES = ["linked", "denied", "error"] as const;
export const LICHESS_ERROR_REASONS = ["state", "upstream", "linked_elsewhere", "already_linked", "rate_limited"] as const;
export type LichessErrorReason = (typeof LICHESS_ERROR_REASONS)[number];

/** A pending checkout older than this is abandoned (§8.1 ACTIVATING: the resolver sends the user back to plan). */
export const PENDING_CHECKOUT_TTL_MS = 30 * 60_000;

// ── Onboarding wire enums (D4-25: lowercase on the wire, uppercase Postgres enums) ──────────────────────────────
export const ONBOARDING_STEPS = ["welcome", "link", "confirm", "level", "goals", "plan", "activating", "done"] as const;
export type OnboardingStepWire = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStepDb = Uppercase<OnboardingStepWire>;
/** DB order of `OnboardingStep` (the monotonic PATCH compares positions in this list). */
export const ONBOARDING_STEPS_DB = ONBOARDING_STEPS.map((s) => s.toUpperCase()) as unknown as readonly OnboardingStepDb[];

export const RATING_BANDS = ["new_to_chess", "under_800", "r800_1200", "r1200_1600", "r1600_2000", "r2000_plus"] as const;
export type RatingBandWire = (typeof RATING_BANDS)[number];
export type RatingBandDb = Uppercase<RatingBandWire>;

export const ONBOARDING_GOALS = ["stop_blundering", "learn_openings", "improve_endgames", "study_legends", "play_friends"] as const;
export type OnboardingGoalWire = (typeof ONBOARDING_GOALS)[number];
export type OnboardingGoalDb = Uppercase<OnboardingGoalWire>;

export const DAILY_MINUTES = [5, 10, 20] as const;
export type DailyMinutes = (typeof DAILY_MINUTES)[number];

/** `ratingBandSource`: `self`, or the provider pool the band was suggested from. */
export const RATING_BAND_SOURCE_RE = /^(self|chesscom:(bullet|blitz|rapid|daily)|lichess:(bullet|blitz|rapid|classical|daily))$/;

/** `toWire("R800_1200") === "r800_1200"`. */
export function toWire<T extends string>(value: T): Lowercase<T> {
  return value.toLowerCase() as Lowercase<T>;
}

/** `fromWire("r800_1200") === "R800_1200"`. */
export function fromWire<T extends string>(value: T): Uppercase<T> {
  return value.toUpperCase() as Uppercase<T>;
}

// ── Rate-limit scopes the route wrapper cannot key (the bucket is per user AND per provider / run) ─────────────
/**
 * ACC-4 sync is limited per user and provider, ACC-8 retry per user and run (§7.0). The route wrapper keys by user
 * only, so these entries carry no `rateLimit`; the handler calls the web limiter itself with this subject id:
 * `checkRateLimit([ACCOUNT_SYNC_LIMIT], { clerkUserId: scopedRateSubject(clerkUserId, provider) })`
 * → key `rl:sync:c:<clerkUserId>:<provider>`.
 */
export function scopedRateSubject(clerkUserId: string, scope: string): string {
  return `${clerkUserId}:${scope}`;
}
