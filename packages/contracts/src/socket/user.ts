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

// ── Registry input (registry.ts spreads these into EMIT_EVENTS with `to: ["user"]`, `seq: false`) ──────────────
export const USER_EVENTS = {
  "import:progress": ImportProgressEvent,
  "import:finished": ImportFinishedEvent,
  "import:failed": ImportFailedEvent,
  "entitlement:changed": EntitlementChangedEvent,
} as const;
export type UserEventName = keyof typeof USER_EVENTS;
export type UserEventPayload<N extends UserEventName> = z.output<(typeof USER_EVENTS)[N]>;
export const USER_EVENT_NAMES = Object.keys(USER_EVENTS) as UserEventName[];

/**
 * Serialised `data` budgets in bytes, measured with the worst-case fixtures in ./fixtures/user.ts (25-character
 * refs, 7-digit counters, the longest provider and error code, a full entitlement DTO with a payment issue) and
 * asserted by test/user.p4.test.ts (worst cases today: 153 / 231 / 160 / 547 B). §7.6's "≈ 125 B" is the typical progress frame.
 */
export const USER_EVENT_BUDGETS = {
  "import:progress": 192,
  "import:finished": 256,
  "import:failed": 192,
  "entitlement:changed": 640,
} as const satisfies Record<UserEventName, number>;
