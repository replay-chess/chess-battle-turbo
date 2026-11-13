// The analysis worker's HTTP surface (phase-03 plan §7.5, §6.6; P3-D12, P3-D22, P3-D26). Every caller of
// `POST /internal/analysis/kick` (web, socket, ops tools) signs with ./auth.ts signInternal(); the worker verifies with
// verifyInternal() and the WORKER_POLICY allow-list. The body is strict, so a typo is a 400 instead of a silent
// no-op, and it stays ≤ KICK_BODY_MAX_BYTES (Caddy enforces 4 KB in front of it).
import { z } from "zod";
import { Ref } from "../http/common";
import { JobKindSchema, PRIORITY_BANDS } from "./jobs";

/** The one wake path for every job kind (P3-D12). */
export const KICK_PATH = "/internal/analysis/kick";
/** The worker refuses larger kick bodies (413). */
export const KICK_BODY_MAX_BYTES = 1_024;
/** Callers abort a kick after this long; a lost kick is healed by the kick CAS, the drain-end sweep and the cron. */
export const KICK_TIMEOUT_MS = 2_000;
/** A kick's `watch` makes that game stream per-game progress for this long, whatever its band (P3-D26). */
export const WATCH_TTL_MS = 10 * 60 * 1000;
/** The A1/A2 kick compare-and-set re-kicks a QUEUED job at most once per this window (P3-D23, AP-09). */
export const KICK_CAS_WINDOW_MS = 30_000;
/** The worker's port on the docker network (never published on the host). */
export const WORKER_PORT = 3003;

export const KICK_REASONS = [
  "live_end",
  "bot_end",
  "opened",
  "retry",
  "regrade",
  "stale_queue",
  "backfill",
  "boot",
  "cron_backstop",
  "smoke",
  "test",
  // P4 (phase-04 §7.7.3): `import` after a link, a sync, an entitlement release or a backlog release; `import_retry`
  // after ACC-8 and the import-status kick CAS.
  "import",
  "import_retry",
] as const;
export type KickReason = (typeof KICK_REASONS)[number];

/**
 * One-shot faults a test kick may carry for its `watch` game (honoured only with APP_ENV=test, §12.3). The same
 * grammar as the worker's `WORKER_FAULT` env hook: `fail_at_ply:12`, `stall_at_ply:20`, `engine_crash:1`,
 * `hold_queue`, `pause_at:writing:5000`.
 */
export const KickFault = z
  .string()
  .max(40)
  // A pause phase is a pipeline span name: a lower-case letter, then letters or digits (`pass1`, `writing`).
  .regex(/^(fail_at_ply:\d{1,4}|stall_at_ply:\d{1,4}|engine_crash:\d{1,2}|hold_queue|pause_at:[a-z][a-z0-9]{0,11}:\d{1,6})$/);
export type KickFault = z.infer<typeof KickFault>;

export const KickBodyV1 = z.strictObject({
  v: z.literal(1),
  reason: z.enum(KICK_REASONS),
  /** P4+ name their kinds; absent = every kind this worker runs. */
  kinds: z.array(JobKindSchema).min(1).max(10).optional(),
  /** The earliest due time the caller just enqueued; keeps the worker's in-memory `nextRunAt` (P3-D22). */
  runAt: z.iso.datetime().optional(),
  /** A gameRef whose progress must stream for WATCH_TTL_MS (P3-D26). */
  watch: Ref.optional(),
  /** APP_ENV=test only: a one-shot fault for `watch`. Ignored (never an error) elsewhere. */
  fault: KickFault.optional(),
});
export type KickBodyV1 = z.infer<typeof KickBodyV1>;
/** What a caller builds (before parsing). */
export type KickBodyInput = z.input<typeof KickBodyV1>;

/** 202. A duplicate kick during a drain is a cheap no-op that answers `draining: true`. */
export const KickResponse = z.object({
  draining: z.boolean(),
  nextRunAt: z.iso.datetime().nullable(),
});
export type KickResponse = z.infer<typeof KickResponse>;

// ── GET /health, GET /ready (docker network only; Caddy answers 404 for them) ───────────────────────────────────
export const WorkerHealthResponse = z.object({ ok: z.literal(true) });
export type WorkerHealthResponse = z.infer<typeof WorkerHealthResponse>;

/** 200 when the engine answered `readyok` and the eval cache is open; else 503 with the same body. */
export const WorkerReadyResponse = z.object({
  ready: z.boolean(),
  engine: z.enum(["ready", "starting", "failed", "fake"]),
  evalCache: z.enum(["open", "off", "seeding", "failed"]),
  draining: z.boolean(),
});
export type WorkerReadyResponse = z.infer<typeof WorkerReadyResponse>;

// ── GET /internal/metrics (signed; web's daily cron backstop, the deploy smoke, P12's admin tile) ───────────────
const Count = z.number().int().min(0);
const ByBand = z.record(z.enum(PRIORITY_BANDS), Count);

/**
 * Gauges served from memory (no DB query, §10.2). Counters are since boot. The queue gauges are the values the last
 * claim or drain saw, stamped with `queueSeenAt`, because an idle worker never queries the database.
 */
export const WorkerMetricsResponse = z.object({
  v: z.literal(1),
  workerId: z.string().max(80),
  bootId: z.string().max(40),
  version: z.string().max(40),
  profile: z.string().max(40),
  uptimeSec: Count,
  draining: z.boolean(),
  nextRunAt: z.iso.datetime().nullable(),
  lastDrainAt: z.iso.datetime().nullable(),
  /** The last HOUSEKEEPING run that finished (the cron backstop alerts after 26 h without one). */
  lastHousekeepingAt: z.iso.datetime().nullable(),
  queue: z.object({
    depth: ByBand,
    oldestSec: ByBand,
    queueSeenAt: z.iso.datetime().nullable(),
  }),
  jobs: z.object({
    done: z.partialRecord(JobKindSchema, Count),
    failed: z.record(z.string().regex(/^[a-z_]{1,32}$/), Count),
    /** p50 job duration per kind over the last 100 runs. */
    durationMsP50: z.partialRecord(JobKindSchema, Count),
  }),
  engine: z.object({ nps: Count.nullable(), restarts: Count }),
  cache: z.object({ hitsMemory: Count, hitsDisk: Count, misses: Count }),
  db: z.object({ statements: Count, retries: Count }),
  lagPauseMs: Count,
  emits: z.record(z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/), Count),
});
export type WorkerMetricsResponse = z.infer<typeof WorkerMetricsResponse>;
