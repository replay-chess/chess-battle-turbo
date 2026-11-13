// Job queue contracts (phase-03 plan §6.6, §7.6, §7.7; P3-D7, P3-D26). Dependency-free apart from zod, so the web,
// the socket server, `@repo/db` (DB/src/jobs.ts re-exports JOB_PRIORITY) and the analysis worker share one copy.
//
// Priority: higher runs first (the claim index is `priority DESC, "fairSeq", "runAt"`). Code never writes a priority
// as a number literal: it names one of JOB_PRIORITY (an ESLint rule bans `priority: <digit>` outside this file).
// Later phases add names here, never literals elsewhere.
import { z } from "zod";

export const JOB_PRIORITY = {
  USER_OPENED: 100,
  IMPORT_SYNC_MANUAL: 100,
  GAME_ENDED: 80,
  IMPORT_SYNC_INITIAL: 60,
  REVIEW_BATCH: 60,
  IMPORT_NEWEST: 50,
  WEAKNESS: 20,
  IMPORT_PURGE: 20,
  IMPORT_SYNC_DAILY: 15,
  BACKLOG: 10,
  HOUSEKEEPING: 0,
} as const;
export type JobPriorityName = keyof typeof JOB_PRIORITY;
export type JobPriority = (typeof JOB_PRIORITY)[JobPriorityName];

/** Per-game `analysis:progress` / `writing` / `done` / `failed` frames stream only at or above this (P3-D26). */
export const PROGRESS_BAND_MIN = JOB_PRIORITY.GAME_ENDED;

/** The two realtime bands: per-game frames (`80+`), or one coalesced `analysis:batch` per user (`<80`). */
export const PRIORITY_BANDS = ["80+", "<80"] as const;
export type PriorityBand = (typeof PRIORITY_BANDS)[number];

/** The band of a priority (telemetry tag `band`, the `/internal/metrics` queue gauges). */
export function bandOf(priority: number): PriorityBand {
  return priority >= PROGRESS_BAND_MIN ? "80+" : "<80";
}

/** Does a job stream per-game events? A watched game (kick `watch`, 10 min) streams whatever its band. */
export function streamsProgress(priority: number, watched: boolean): boolean {
  return watched || priority >= PROGRESS_BAND_MIN;
}

// ── Kinds and statuses (DB enums JobKind / JobStatus, M3) ───────────────────────────────────────────────────────
/** Every `JobKind` value M3 creates. P3 writes only P3_JOB_KINDS; the rest are reserved for later phases. */
export const JOB_KINDS = [
  "ANALYZE_GAME",
  "REVIEW_TEXT",
  "LEGEND_COMPARE",
  "IMPORT_SYNC",
  "IMPORT_PURGE",
  "RECOMPUTE_WEAKNESS",
  "EXPORT_BUILD",
  "ACCOUNT_PURGE",
  "DODO_CUSTOMER_SYNC",
  "HOUSEKEEPING",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const JobKindSchema = z.enum(JOB_KINDS);

/** The kinds the P3 worker claims and runs. */
export const P3_JOB_KINDS = ["ANALYZE_GAME", "LEGEND_COMPARE", "HOUSEKEEPING"] as const satisfies readonly JobKind[];
export type P3JobKind = (typeof P3_JOB_KINDS)[number];

/**
 * The kinds P4 adds to the worker (phase-04 plan §7.7.1, D4-02): both run on the I/O lane (concurrency 2), never on
 * the engine lane. Both values already exist in M3's `JobKind`, so P4 writes no enum migration.
 */
export const P4_JOB_KINDS = ["IMPORT_SYNC", "IMPORT_PURGE"] as const satisfies readonly JobKind[];
export type P4JobKind = (typeof P4_JOB_KINDS)[number];

/** Every kind a worker of this build runs (the engine lane's P3 kinds plus the I/O lane's P4 kinds). */
export const RUN_JOB_KINDS = [...P3_JOB_KINDS, ...P4_JOB_KINDS] as const;
export type RunJobKind = P3JobKind | P4JobKind;

export const JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * `jobs."maxAttempts"` written at insert (§7.7): ANALYZE_GAME 4, LEGEND_COMPARE 3, HOUSEKEEPING 2; P4 (phase-04
 * §7.7.1) IMPORT_SYNC 5, IMPORT_PURGE 5.
 */
export const JOB_MAX_ATTEMPTS = {
  ANALYZE_GAME: 4,
  LEGEND_COMPARE: 3,
  HOUSEKEEPING: 2,
  IMPORT_SYNC: 5,
  IMPORT_PURGE: 5,
} as const satisfies Record<RunJobKind, number>;

/**
 * P4 back-off per attempt (phase-04 §7.7.1, §8.11), seconds; the last entry repeats. IMPORT_SYNC honours a
 * provider `Retry-After` when it is longer. P3's kinds keep the worker's BACKOFF_SEC [30, 120, 600].
 */
export const IMPORT_BACKOFF_SEC = {
  IMPORT_SYNC: [60, 300, 900, 900],
  IMPORT_PURGE: [30, 120, 600],
} as const satisfies Record<P4JobKind, readonly number[]>;

/** Games under this many plies (and aborted games) are SKIPPED and get no job (§7.6); zod-free in http/plain.ts. */
export { ANALYSIS_MIN_PLIES } from "../http/plain";

// ── Dedupe keys (`jobs."dedupeKey"`, unique) ────────────────────────────────────────────────────────────────────
/** bigint ids travel as decimal strings. */
export const BigIntString = z.string().regex(/^[1-9][0-9]{0,18}$/);
export type BigIntString = z.infer<typeof BigIntString>;

/** A UTC calendar day, `yyyy-mm-dd`. */
export const IsoDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

type Id = bigint | number | string;

/** `analyze:<gameId>`: one ANALYZE_GAME job per game, ever (a regrade resets the DONE row). */
export function analyzeDedupeKey(gameId: Id): string {
  return `analyze:${String(gameId)}`;
}

/** `legend:<gameId>:<userId>`: one LEGEND_COMPARE job per member side of a legend game. */
export function legendDedupeKey(gameId: Id, userId: Id): string {
  return `legend:${String(gameId)}:${String(userId)}`;
}

/**
 * `import:<linkedAccountId>`: the one reusable IMPORT_SYNC row per linked account (initial, manual, daily, retry;
 * the worker reschedules it for the next daily sync instead of finishing it, D4-27).
 */
export function importDedupeKey(linkedAccountId: Id): string {
  return `import:${String(linkedAccountId)}`;
}

/** `importpurge:<userId>:<provider>`: one IMPORT_PURGE row per member and provider (`chesscom` | `lichess`). */
export function importPurgeDedupeKey(userId: Id, provider: "CHESSCOM" | "LICHESS"): string {
  return `importpurge:${String(userId)}:${provider.toLowerCase()}`;
}

/** `housekeeping:<yyyy-mm-dd>`: one HOUSEKEEPING row per UTC day, planned by DAILY_PLAN. */
export function housekeepingDedupeKey(day: string): string {
  if (!IsoDay.safeParse(day).success) throw new Error(`housekeepingDedupeKey: "${day}" is not yyyy-mm-dd`);
  return `housekeeping:${day}`;
}

// ── Payloads (`jobs.payload`, versioned: an older worker releases a job whose `v` it cannot read) ──────────────
/** The highest payload version this build reads. */
export const PAYLOAD_V_MAX = 1;

/** P4 appends `import` (imported games: the batch writer's eager ranks and the backlog slices, phase-04 §8.8–8.9). */
export const ANALYZE_REASONS = ["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke", "import"] as const;
export type AnalyzeReason = (typeof ANALYZE_REASONS)[number];

/** The longest game an `evalHint` may describe (games."plyCount" is a smallint; Lichess games stay far below). */
export const EVAL_HINT_MAX_PLIES = 2_000;
/** Mate scores are `sign · (30000 − n)` (CA codec), so every centipawn value fits ±30000. */
export const EVAL_HINT_MAX_ABS = 30_000;

/**
 * P4 (phase-04 §6.4, §8.7; R-LI-08): White-POV centipawns per position from the Lichess export (`analysis[i].eval`,
 * or a mate as `sign · (30000 − |n|)`), sent only when it covers every ply. Lets the worker skip pass 1 and write
 * `evalSource = LICHESS` (or `MIXED` when it had to fill gaps).
 */
export const EvalHint = z.object({
  source: z.literal("lichess"),
  cp: z.array(z.int().min(-EVAL_HINT_MAX_ABS).max(EVAL_HINT_MAX_ABS)).min(1).max(EVAL_HINT_MAX_PLIES),
});
export type EvalHint = z.infer<typeof EvalHint>;

/**
 * Both P4 fields are optional, so `v` stays 1: a P3 worker strips them (zod `object`), a P4 worker reads them.
 * `importRunId`: P3's final batch also bumps `import_runs.analysed` (a no-op once the run row is pruned).
 */
export const AnalyzeGamePayloadV1 = z.object({
  v: z.literal(1),
  gameId: BigIntString,
  gameRef: z.string().min(1).max(40),
  reason: z.enum(ANALYZE_REASONS),
  importRunId: BigIntString.optional(),
  evalHint: EvalHint.optional(),
});
export type AnalyzeGamePayloadV1 = z.infer<typeof AnalyzeGamePayloadV1>;

export const LegendComparePayloadV1 = z.object({
  v: z.literal(1),
  gameId: BigIntString,
  userId: BigIntString,
  gameRef: z.string().min(1).max(40),
});
export type LegendComparePayloadV1 = z.infer<typeof LegendComparePayloadV1>;

export const HousekeepingPayloadV1 = z.object({ v: z.literal(1), day: IsoDay });
export type HousekeepingPayloadV1 = z.infer<typeof HousekeepingPayloadV1>;

/** `ImportTrigger` (DB spelling: job payloads are internal and keep the Postgres enum values, D4-25). */
export const IMPORT_TRIGGERS_DB = ["INITIAL", "MANUAL", "DAILY", "RETRY"] as const;
export type ImportTriggerDb = (typeof IMPORT_TRIGGERS_DB)[number];

/**
 * IMPORT_SYNC (phase-04 §6.4). `runId` = the `import_runs` row this job drives; null for a DAILY wake that creates
 * its run only when it finds new games (a DAILY run with 0 new games is never inserted, §6.8).
 */
export const ImportSyncPayloadV1 = z.object({
  v: z.literal(1),
  linkedAccountId: BigIntString,
  runId: BigIntString.nullable(),
  trigger: z.enum(IMPORT_TRIGGERS_DB),
});
export type ImportSyncPayloadV1 = z.infer<typeof ImportSyncPayloadV1>;

/** IMPORT_PURGE (phase-04 §8.12): purges by (userId, source), so it works after the link row is gone. */
export const ImportPurgePayloadV1 = z.object({
  v: z.literal(1),
  userId: BigIntString,
  provider: z.enum(["CHESSCOM", "LICHESS"]),
  requestedAt: z.iso.datetime(),
});
export type ImportPurgePayloadV1 = z.infer<typeof ImportPurgePayloadV1>;

/** The payload schema of each kind a worker of this build runs (P3 engine lane, P4 I/O lane). */
export const JOB_PAYLOADS = {
  ANALYZE_GAME: AnalyzeGamePayloadV1,
  LEGEND_COMPARE: LegendComparePayloadV1,
  HOUSEKEEPING: HousekeepingPayloadV1,
  IMPORT_SYNC: ImportSyncPayloadV1,
  IMPORT_PURGE: ImportPurgePayloadV1,
} as const satisfies Record<RunJobKind, z.ZodType>;
export type JobPayload<K extends RunJobKind> = z.infer<(typeof JOB_PAYLOADS)[K]>;

export type PayloadRead<K extends RunJobKind> =
  | { ok: true; payload: JobPayload<K> }
  /** `newer`: a later build wrote it; the claimer releases the job untouched. `invalid`: fail the job. */
  | { ok: false; reason: "newer" | "invalid" };

/** Reads a claimed job's payload: a version above PAYLOAD_V_MAX is `newer` (release it), anything else is parsed. */
export function readJobPayload<K extends RunJobKind>(kind: K, payload: unknown): PayloadRead<K> {
  const v = typeof payload === "object" && payload !== null ? (payload as { v?: unknown }).v : undefined;
  if (typeof v === "number" && Number.isInteger(v) && v > PAYLOAD_V_MAX) return { ok: false, reason: "newer" };
  const parsed = JOB_PAYLOADS[kind].safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return { ok: true, payload: parsed.data as JobPayload<K> };
}

// ── The review ETA (phase-03 plan §5.2 `queue`, §5.8 the game-over seed) ──────────────────────────────────────────
// One model for every place that shows "about N s": the finish statement's seed (@repo/db finishAnalysisOf, socket
// and bot complete) and the web's A2/A3/A4 answers. Dev SLO class (§9.1, worker on 0.75 core): pass 1 at ~0.35 s a
// ply plus ≤ 6 pass-2 positions; a 60-ply game is ready in ~25 s. Display estimates only, never deadlines.
export const ETA_SECONDS_PER_PLY = 0.35;
export const ETA_PASS2_SECONDS = 5;
/** What one job ahead in the queue costs on average. */
export const ETA_SECONDS_PER_QUEUED_JOB = 25;

/** Seconds until an analysis with `remainingPlies` still to grade is likely ready, with `ahead` jobs before it (≥ 1). */
export function analysisEtaSec(input: { ahead: number; remainingPlies: number }): number {
  const own = Math.max(0, input.remainingPlies) * ETA_SECONDS_PER_PLY + ETA_PASS2_SECONDS;
  return Math.max(1, Math.ceil(Math.max(0, input.ahead) * ETA_SECONDS_PER_QUEUED_JOB + own));
}
