// Connected accounts contracts (phase-04 plan §7.0 ACC-1…ACC-6, OAU-1/2, §7.1, §8.11; D4-01, D4-08, D4-10, D4-21,
// D4-26). Wire enums are lowercase; job payloads keep the DB spelling (CT/internal/jobs.ts). `avatarUrl` travels
// but the UI renders initials until the Chess.com terms review clears (D4-26). Lichess tokens never appear anywhere:
// the callback revokes the token before it responds (D4-21).
import { z } from "zod";
import { IsoDateTime, Ref } from "./common";
import { OnboardingView, TimeZone } from "./onboarding";
import {
  CHESSCOM_USERNAME_MESSAGE,
  CHESSCOM_USERNAME_RE,
  IMPORT_ERROR_CODES,
  IMPORT_PHASES,
  IMPORT_RUN_STATUSES,
  IMPORT_TRIGGERS,
  LICHESS_RETURN_PATHS,
  LINK_VIEW_STATUSES,
  PROVIDER_SLUGS,
  TIME_CLASS_SLUGS,
} from "./p04-plain";

export {
  ACTIVE_IMPORT_RUN_STATUSES,
  CHESSCOM_USERNAME_MESSAGE,
  CHESSCOM_USERNAME_RE,
  IMPORT_ERROR_CODES,
  IMPORT_PHASES,
  IMPORT_RUN_STATUSES,
  IMPORT_TRIGGERS,
  LICHESS_ERROR_REASONS,
  LICHESS_RETURN_PATHS,
  LICHESS_RETURN_STATES,
  LINK_VIEW_STATUSES,
  PROVIDER_SLUGS,
  TIME_CLASS_SLUGS,
  isChessComUsername,
  normaliseChessComUsername,
  providerFromDb,
  providerToDb,
  scopedRateSubject,
  type ImportErrorCodeWire,
  type ImportPhase,
  type ImportRunStatusWire,
  type ImportTriggerWire,
  type LichessErrorReason,
  type LichessReturnPath,
  type ProviderDb,
} from "./p04-plain";
export { TimeZone } from "./onboarding";

export const ProviderSlug = z.enum(PROVIDER_SLUGS);
export type ProviderSlug = z.infer<typeof ProviderSlug>;

export const TimeClassSlug = z.enum(TIME_CLASS_SLUGS);
export type TimeClassSlug = z.infer<typeof TimeClassSlug>;

/** A typed handle: trimmed, one leading `@` dropped, then 3–25 of `[A-Za-z0-9_-]`. */
export const ChessComUsername = z
  .string()
  .trim()
  .max(64)
  .transform((s) => s.replace(/^@/, ""))
  .pipe(z.string().regex(CHESSCOM_USERNAME_RE, CHESSCOM_USERNAME_MESSAGE));
export type ChessComUsername = z.output<typeof ChessComUsername>;

// ── Ratings ─────────────────────────────────────────────────────────────────────────────────────────────────────
const Count = z.int().min(0);

export const RatingEntry = z.object({ rating: z.int(), best: z.int().nullable(), games: Count });
export type RatingEntry = z.infer<typeof RatingEntry>;

/** Per pool; absent = the account has no rating in that pool. */
export const RatingsView = z
  .object({ bullet: RatingEntry, blitz: RatingEntry, rapid: RatingEntry, classical: RatingEntry, daily: RatingEntry })
  .partial();
export type RatingsView = z.infer<typeof RatingsView>;

/** The pool the band suggestion picks ("Rapid 1184"); null with no rated games. */
export const Headline = z.object({ timeClass: TimeClassSlug, rating: z.int() }).nullable();
export type Headline = z.infer<typeof Headline>;

// ── ACC-2 `POST /api/accounts/chesscom/lookup` ──────────────────────────────────────────────────────────────────
export const LookupBody = z.strictObject({ username: ChessComUsername });
export type LookupBody = z.infer<typeof LookupBody>;

export const LookupProfile = z.object({
  /** Lower-case handle (the cache and link key). */
  username: z.string().max(40),
  /** The handle as Chess.com spells it. */
  displayUsername: z.string().max(40),
  name: z.string().max(80).nullable(),
  avatarUrl: z.url().max(300).nullable(),
  countryCode: z.string().length(2).nullable(),
  joinedAt: IsoDateTime.nullable(),
  title: z.string().max(4).nullable(),
});
export type LookupProfile = z.infer<typeof LookupProfile>;

/** `private` = closed account; `no_games` = found with 0 rated games. A missing profile is a 404. */
export const LookupStatus = z.enum(["found", "private", "no_games"]);
export type LookupStatus = z.infer<typeof LookupStatus>;

export const LookupData = z.object({
  status: LookupStatus,
  profile: LookupProfile,
  ratings: RatingsView,
  headline: Headline,
  /** All-time rated total from Chess.com stats (D4-08: the 12-month total arrives with the import's reading phase). */
  totalRatedGames: Count,
});
export type LookupData = z.infer<typeof LookupData>;

// ── Runs and accounts (ACC-1, §8.11) ────────────────────────────────────────────────────────────────────────────
export const ImportErrorCode = z.enum(IMPORT_ERROR_CODES);
export type ImportErrorCode = z.infer<typeof ImportErrorCode>;

/** The public part of `ImportErrorV1` (the message stays server-side). */
export const ImportErrorView = z.object({ code: ImportErrorCode, at: IsoDateTime, retryAt: IsoDateTime.nullable() });
export type ImportErrorView = z.infer<typeof ImportErrorView>;

export const ImportTriggerSchema = z.enum(IMPORT_TRIGGERS);
export const ImportRunStatus = z.enum(IMPORT_RUN_STATUSES);
export type ImportRunStatus = z.infer<typeof ImportRunStatus>;
export const ImportPhaseSchema = z.enum(IMPORT_PHASES);

/** One import run (`import_runs`), the user-visible progress row (B5, D4-03). */
export const RunView = z.object({
  ref: Ref,
  provider: ProviderSlug,
  trigger: ImportTriggerSchema,
  status: ImportRunStatus,
  phase: ImportPhaseSchema.nullable(),
  seen: Count,
  /** Games in the window after filters; known at the end of the reading phase. */
  total: Count.nullable(),
  imported: Count,
  skipped: Count,
  analysisQueued: Count,
  analysed: Count,
  error: ImportErrorView.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
});
export type RunView = z.infer<typeof RunView>;

export const LinkViewStatus = z.enum(LINK_VIEW_STATUSES);
export type LinkViewStatus = z.infer<typeof LinkViewStatus>;

export const LinkedAccountView = z.object({
  provider: ProviderSlug,
  username: z.string().max(40),
  displayName: z.string().max(80).nullable(),
  /** Stored, never rendered until OD-2 clears (D4-26). */
  avatarUrl: z.url().max(300).nullable(),
  title: z.string().max(4).nullable(),
  ratings: RatingsView,
  headline: Headline,
  totalRatedGames: Count.nullable(),
  /** Lichess links are verified by OAuth; Chess.com links stay unverified in P4 (D4-10). */
  verified: z.boolean(),
  status: LinkViewStatus,
  autoImport: z.boolean(),
  lastSyncAt: IsoDateTime.nullable(),
  lastSyncOkAt: IsoDateTime.nullable(),
  nextAllowedSyncAt: IsoDateTime.nullable(),
  nextAutoSyncAt: IsoDateTime.nullable(),
  importedCount: Count,
  skippedCount: Count,
  lastError: ImportErrorView.nullable(),
  /** The newest run of this account (active, or the last finished one). */
  run: RunView.nullable(),
});
export type LinkedAccountView = z.infer<typeof LinkedAccountView>;

/** ACC-1 `GET /api/accounts`: at most one account per provider. */
export const AccountsData = z.object({ items: z.array(LinkedAccountView).max(PROVIDER_SLUGS.length) });
export type AccountsData = z.infer<typeof AccountsData>;

// ── ACC-3 `POST /api/accounts/chesscom` (Idempotency-Key required) ─────────────────────────────────────────────
export const LinkContext = z.enum(["onboarding", "settings"]);
export type LinkContext = z.infer<typeof LinkContext>;

export const LinkChessComBody = z.strictObject({ username: ChessComUsername, context: LinkContext });
export type LinkChessComBody = z.infer<typeof LinkChessComBody>;

/** 201 on a new link, 200 on the idempotent re-link of the same account. `onboarding` only for context onboarding. */
export const LinkData = z.object({ account: LinkedAccountView, run: RunView.nullable(), onboarding: OnboardingView.nullable() });
export type LinkData = z.infer<typeof LinkData>;

export const ProviderParams = z.object({ provider: ProviderSlug });
export type ProviderParams = z.infer<typeof ProviderParams>;

// ── ACC-4 sync, ACC-5 settings, ACC-6 unlink ────────────────────────────────────────────────────────────────────
/** ACC-4 has no body; an empty or `{}` body is accepted. */
export const SyncBody = z.strictObject({}).default({});
export const SyncData = z.object({ run: RunView });
export type SyncData = z.infer<typeof SyncData>;

/** ACC-5. `timeZone` is sent when the browser's zone differs from `me.user.timeZone` (the daily hour depends on it). */
export const PatchAccountBody = z.strictObject({ autoImport: z.boolean(), timeZone: TimeZone.optional() });
export type PatchAccountBody = z.infer<typeof PatchAccountBody>;

export const UnlinkQuery = z.object({ deleteGames: z.enum(["0", "1"]).default("0") });
export type UnlinkQuery = z.infer<typeof UnlinkQuery>;

/** `purge.games` = the imported games queued for deletion (null when `deleteGames=0`). */
export const UnlinkData = z.object({ removed: z.literal(true), purge: z.object({ games: Count }).nullable() });
export type UnlinkData = z.infer<typeof UnlinkData>;

// ── OAU-1/OAU-2 Lichess OAuth (PKCE, no scopes; the token is revoked inside the callback, D4-21) ───────────────
export const LichessStartQuery = z.object({ returnTo: z.enum(LICHESS_RETURN_PATHS).default("/settings/connected") });
export type LichessStartQuery = z.infer<typeof LichessStartQuery>;

export const LichessCallbackQuery = z.union([
  z.object({ code: z.string().min(1).max(512), state: z.string().min(16).max(128) }),
  z.object({
    error: z.string().max(64),
    state: z.string().max(128).optional(),
    error_description: z.string().max(300).optional(),
  }),
  // Anything else (a truncated, tampered or empty redirect) still reaches the handler, which clears the single-use
  // PKCE cookie and redirects with `?lichess=error&reason=state` instead of a raw 400 (§11.2; FIX-1).
  z.object({}).transform(() => ({ malformed: true as const })),
]);
export type LichessCallbackQuery = z.infer<typeof LichessCallbackQuery>;

// ── Rate limits (§7.0). Buckets the route wrapper applies sit on the registry entries (registry/accounts.ts); the two
// scoped ones below are applied by the handlers with scopedRateSubject() (p04-plain.ts). ─────────────────────────
/** ACC-4: one manual sync per user and provider per 30 s. */
export const ACCOUNT_SYNC_LIMIT = { bucket: "sync", limit: 1, windowSec: 30, by: "user" } as const;
/** ACC-8: one retry per user and run per 30 s (same bucket shape as sync, its own key). */
export const IMPORT_RETRY_LIMIT = { bucket: "sync", limit: 1, windowSec: 30, by: "user" } as const;
/** ACC-3, OAU-1, ACC-6. */
export const ACCOUNT_LINK_LIMIT = { bucket: "link", limit: 5, windowSec: 60, by: "user" } as const;
/** ACC-2: per user and per IP. */
export const ACCOUNT_LOOKUP_LIMITS = [
  { bucket: "lookup", limit: 10, windowSec: 60, by: "user" },
  { bucket: "lookup-ip", limit: 30, windowSec: 60, by: "ip" },
] as const;
/** ACC-5. */
export const ACCOUNT_SETTINGS_LIMIT = { bucket: "settings", limit: 30, windowSec: 60, by: "user" } as const;

/** Server-side upstream cache of a lookup (web `unstable_cache`, worker LRU; D4-23). */
export const LOOKUP_CACHE_SEC = 600;
/** The web → worker lookup fallback budget (D4-23). */
export const LOOKUP_FALLBACK_TIMEOUT_MS = 6_000;
