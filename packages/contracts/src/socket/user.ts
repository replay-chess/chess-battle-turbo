// User-room events of P4 (phase-04 plan §7.6; api-perf AP-10, AP-39, AP-44). Every event goes to `user:{userRef}`
// through P2's `POST /internal/emit {v:1, targets, event, data, dedupeKey?}` and is registered in registry.ts
// EMIT_EVENTS with the schema and budget below. Payloads carry `v: 1` (as P3's analysis events); the socket server
// adds `useq` on delivery, so these objects are not strict.
//
// Emitters (CT/internal/auth.ts INTERNAL_POLICY): the worker (kid `wk`) emits `import:*` and P3's `games:changed`
// (`{v:1}`; reused for imports and purges, no new fields); the web (kid `web`) emits `entitlement:changed`. `wk`
// cannot emit `entitlement:changed`, so a compromised worker cannot fake a membership.
import { z } from "zod";
import { ProviderSlug, ImportErrorCode } from "../http/accounts";
import { Ref } from "../http/common";
import { Entitlement } from "../http/me";
import { ProgressStepKey } from "../http/weakness";

const Count = z.int().min(0);

// ── Cadence (worker side, §7.6) ─────────────────────────────────────────────────────────────────────────────────
/** `import:progress` while reading: every this many games … */
export const IMPORT_PROGRESS_EVERY_GAMES = 250;
/** … or this often, whichever comes first; saving emits after each 100-game statement. Coalesced to ≤ 1/s. */
export const IMPORT_PROGRESS_EVERY_MS = 2_000;
export const IMPORT_PROGRESS_MIN_GAP_MS = 1_000;
/** `games:changed` from imports and purges, at most once per user per this interval. */
export const IMPORT_GAMES_CHANGED_MIN_GAP_MS = 10_000;

/** `import:finished:<runRef>`: a retried emit of a terminal event is not shown twice. */
export function importFinishedDedupeKey(runRef: string): string {
  return `import:finished:${runRef}`;
}

/** `import:failed:<runRef>:<attempt>`: one failure frame per job attempt. */
export function importFailedDedupeKey(runRef: string, attempt: number): string {
  return `import:failed:${runRef}:${attempt}`;
}

// ── Payloads ────────────────────────────────────────────────────────────────────────────────────────────────────
/** ≤ 1 per second per user. `analysed` = games of this run already reviewed (AP-10: no per-game backlog events). */
export const ImportProgressEvent = z.object({
  v: z.literal(1),
  runRef: Ref,
  provider: ProviderSlug,
  phase: z.enum(["reading", "saving"]),
  seen: Count,
  imported: Count,
  total: Count.nullable(),
  analysed: Count,
});
export type ImportProgressEvent = z.infer<typeof ImportProgressEvent>;

/** Run DONE. Not emitted for a DAILY run with 0 new games. */
export const ImportFinishedEvent = z.object({
  v: z.literal(1),
  runRef: Ref,
  provider: ProviderSlug,
  imported: Count,
  skipped: Count,
  total: Count,
  newGames: Count,
  analysisQueued: Count,
  analysed: Count,
  firstReviewGameRef: Ref.nullable(),
});
export type ImportFinishedEvent = z.infer<typeof ImportFinishedEvent>;

/** Run FAILED, or a rate-limit pause (`code: rate_limited` with `retryAt`, the run continues later). */
export const ImportFailedEvent = z.object({
  v: z.literal(1),
  runRef: Ref,
  provider: ProviderSlug,
  code: ImportErrorCode,
  retryAt: z.iso.datetime().nullable(),
  imported: Count,
  total: Count.nullable(),
});
export type ImportFailedEvent = z.infer<typeof ImportFailedEvent>;

/**
 * Every applied billing snapshot that changes the viewer's entitlement DTO, and every recorded payment failure
 * (web only). The client writes `entitlement` into `qk.me()` without a refetch (AP-39). `subscriptionUpdatedAt`
 * replaces P10's `membership:updated` (api-perf §1); `paymentFailed` lets an open activation page turn `failed`.
 */
export const EntitlementChangedEvent = z.object({
  v: z.literal(1),
  entitlement: Entitlement,
  subscriptionUpdatedAt: z.iso.datetime().nullable(),
  paymentFailed: z.boolean().optional(),
});
export type EntitlementChangedEvent = z.infer<typeof EntitlementChangedEvent>;

// ── P5 (phase-05 plan §7.1, §7.4, §5.5): the Mistake Bank events ───────────────────────────────────────────────
// Changes that come from an analysis are folded into `analysis:done` / `analysis:batch` (`bankAdded`, `bankDue`,
// ./analysis.ts); these two are emitted only off the analysis path. The worker (kid `wk`) emits `mistakes:added`
// from the EXTRACT_MISTAKES backfill (coalesced ≤ 1 per user per 60 s, dedupeKey mistakesAddedDedupeKey());
// the web (kid `web`) emits `bank:due_changed` after a member's own grading, skip, removal or A6 toggle.

/** `mistakes:added` is coalesced per user to at most one per this interval (WK/src/extract/coalesce.ts). */
export const MISTAKES_ADDED_MIN_GAP_MS = 60_000;

/** `mistakes:<userRef>:<minute>`: one coalesced frame per user and minute (minute = floor(epoch ms / 60 000)). */
export function mistakesAddedDedupeKey(userRef: string, epochMs: number): string {
  return `mistakes:${userRef}:${Math.floor(epochMs / 60_000)}`;
}

export { BankAdded } from "./analysis";

/** The member's due counts after a change made elsewhere (another device graded, skipped or removed a card). */
export const BankDueChangedEvent = z.object({
  v: z.literal(1),
  /** The capped count the nav and Home show. */
  bankDue: Count,
  /** Due before the daily cap. */
  dueRaw: Count,
  /** BANK cards in the bank. */
  total: Count,
  /** The next release with due cards, or null. */
  nextAt: z.iso.datetime().nullable(),
});
export type BankDueChangedEvent = z.infer<typeof BankDueChangedEvent>;

/** Backfill / re-extraction only (`cardsAdded > 0`). `games` = games extracted since the last frame. */
export const MistakesAddedEvent = z.object({
  v: z.literal(1),
  games: Count,
  /** Mistake rows inserted or seen again. */
  added: Count,
  cardsAdded: Count,
  total: Count,
  bankDue: Count,
});
export type MistakesAddedEvent = z.infer<typeof MistakesAddedEvent>;

// ── P6 (phase-06 plan §7.3, §7.4.4): the Weakness Profile events ───────────────────────────────────────────────
// The worker (kid `wk`, `weakness:*` in INTERNAL_POLICY) emits both to the member's user room. `z.object`, not strict
// (interface check §0.7): the socket parses `data` with these schemas, and an older socket must not drop a frame a
// newer worker sent with an extra field.

/** `weakness:progress` at most once per this interval per user, or on every WEAKNESS_PROGRESS_STEP_PCT step. */
export const WEAKNESS_PROGRESS_MIN_GAP_MS = 10_000;
export const WEAKNESS_PROGRESS_STEP_PCT = 5;

/** `weakness:ready:<userRef>:<snapshotKey>`: one frame per snapshot write. */
export function weaknessReadyDedupeKey(userRef: string, snapshotKey: string): string {
  return `weakness:ready:${userRef}:${snapshotKey}`;
}

/** While the member has no READY profile: an in-scope analysis finished, an import page landed, a recompute started. */
export const WeaknessProgressEvent = z.object({
  v: z.literal(1),
  pct: z.int().min(0).max(100),
  step: ProgressStepKey,
  etaSec: z.int().min(0).max(86_400).nullable(),
  stalled: z.boolean(),
  analysed: Count,
  target: z.int().min(1).max(300),
  importDone: Count.nullable(),
  importTotal: Count.nullable(),
});
export type WeaknessProgressEvent = z.infer<typeof WeaknessProgressEvent>;

/** After every snapshot write (READY, INSUFFICIENT or FAILED). `bumped` → the client turns the Train dot on. */
export const WeaknessReadyEvent = z.object({
  v: z.literal(1),
  snapshotKey: z.string().min(1).max(40),
  status: z.enum(["ready", "insufficient", "failed"]),
  version: Count,
  bumped: z.boolean(),
  topLabel: z.string().max(40).nullable(),
});
export type WeaknessReadyEvent = z.infer<typeof WeaknessReadyEvent>;

// ── Registry input (registry.ts spreads these into EMIT_EVENTS with `to: ["user"]`, `seq: false`) ──────────────
export const USER_EVENTS = {
  "import:progress": ImportProgressEvent,
  "import:finished": ImportFinishedEvent,
  "import:failed": ImportFailedEvent,
  "entitlement:changed": EntitlementChangedEvent,
  "bank:due_changed": BankDueChangedEvent,
  "mistakes:added": MistakesAddedEvent,
  "weakness:progress": WeaknessProgressEvent,
  "weakness:ready": WeaknessReadyEvent,
} as const;
export type UserEventName = keyof typeof USER_EVENTS;
export type UserEventPayload<N extends UserEventName> = z.output<(typeof USER_EVENTS)[N]>;
export const USER_EVENT_NAMES = Object.keys(USER_EVENTS) as UserEventName[];

/**
 * Serialised `data` budgets in bytes, measured with the worst-case fixtures in ./fixtures/user.ts (25-character
 * refs, 7-digit counters, the longest provider and error code, a full entitlement DTO with a payment issue) and
 * asserted by test/user.p4.test.ts (worst cases today: 153 / 231 / 160 / 547 B). §7.6's "≈ 125 B" is the typical progress frame.
 * P5 (phase-05 §9.4 "≤ 120 B each", asserted by test/user.p5.test.ts with 5-digit counters and an ISO instant):
 * bank:due_changed 88 B, mistakes:added 84 B.
 * P6 (phase-06 §7.3, §9.3; asserted by test/user.p6.test.ts): weakness:progress 138 B (6-digit counters, a full-day
 * ETA) within the plan's 180 B. weakness:ready measures 154 B at its schema limits (a 7-digit version, the plan's own
 * 40-character `topLabel` maximum): the plan's "≤ 120 B" cannot hold that schema, so the budget is 160 B (a typical
 * READY frame is 112 B).
 */
export const USER_EVENT_BUDGETS = {
  "import:progress": 192,
  "import:finished": 256,
  "import:failed": 192,
  "entitlement:changed": 640,
  "bank:due_changed": 120,
  "mistakes:added": 120,
  "weakness:progress": 180,
  "weakness:ready": 160,
} as const satisfies Record<UserEventName, number>;
