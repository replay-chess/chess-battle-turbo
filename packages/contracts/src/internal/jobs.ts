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

export const JOB_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** `jobs."maxAttempts"` written at insert (§7.7): ANALYZE_GAME 4, LEGEND_COMPARE 3, HOUSEKEEPING 2. */
export const JOB_MAX_ATTEMPTS = {
  ANALYZE_GAME: 4,
  LEGEND_COMPARE: 3,
  HOUSEKEEPING: 2,
} as const satisfies Record<P3JobKind, number>;

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

/** `housekeeping:<yyyy-mm-dd>`: one HOUSEKEEPING row per UTC day, planned by DAILY_PLAN. */
export function housekeepingDedupeKey(day: string): string {
  if (!IsoDay.safeParse(day).success) throw new Error(`housekeepingDedupeKey: "${day}" is not yyyy-mm-dd`);
  return `housekeeping:${day}`;
}

// ── Payloads (`jobs.payload`, versioned: an older worker releases a job whose `v` it cannot read) ──────────────
/** The highest payload version this build reads. */
export const PAYLOAD_V_MAX = 1;

export const ANALYZE_REASONS = ["live_end", "bot_end", "opened", "retry", "regrade", "backfill", "smoke"] as const;
export type AnalyzeReason = (typeof ANALYZE_REASONS)[number];

export const AnalyzeGamePayloadV1 = z.object({
  v: z.literal(1),
  gameId: BigIntString,
  gameRef: z.string().min(1).max(40),
  reason: z.enum(ANALYZE_REASONS),
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

/** The payload schema of each kind P3 runs. */
export const JOB_PAYLOADS = {
  ANALYZE_GAME: AnalyzeGamePayloadV1,
  LEGEND_COMPARE: LegendComparePayloadV1,
  HOUSEKEEPING: HousekeepingPayloadV1,
} as const satisfies Record<P3JobKind, z.ZodType>;
export type JobPayload<K extends P3JobKind> = z.infer<(typeof JOB_PAYLOADS)[K]>;

export type PayloadRead<K extends P3JobKind> =
  | { ok: true; payload: JobPayload<K> }
  /** `newer`: a later build wrote it; the claimer releases the job untouched. `invalid`: fail the job. */
  | { ok: false; reason: "newer" | "invalid" };

/** Reads a claimed job's payload: a version above PAYLOAD_V_MAX is `newer` (release it), anything else is parsed. */
export function readJobPayload<K extends P3JobKind>(kind: K, payload: unknown): PayloadRead<K> {
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
