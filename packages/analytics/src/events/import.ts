// Import events of phase 4 (phase-04 plan 10.1, TST X6): what the analysis worker reports about imports and purges,
// batched by posthog-node (distinct_id = User.referenceId). Closed property sets: providers, triggers, counts,
// durations and error codes only, never a username, an external id, a ref of a game or a FEN.
import { z } from "zod";

/** `PROVIDER_SLUGS` of @repo/contracts/http/p04-plain (drift-tested). */
export const IMPORT_EVENT_PROVIDERS = ["chesscom", "lichess"] as const;
/** `IMPORT_TRIGGERS` of @repo/contracts/http/p04-plain (drift-tested). */
export const IMPORT_EVENT_TRIGGERS = ["initial", "manual", "daily", "retry"] as const;
/** `IMPORT_ERROR_CODES` of @repo/contracts/http/p04-plain (drift-tested in import.test.ts; no runtime dependency). */
export const IMPORT_EVENT_CODES = ["not_found", "closed", "upstream", "timeout", "rate_limited", "internal"] as const;

const provider = z.enum(IMPORT_EVENT_PROVIDERS);
const trigger = z.enum(IMPORT_EVENT_TRIGGERS);
const games = z.number().int().min(0).max(10_000);
/** 0 .. 1 h. */
const ms = z.number().int().min(0).max(3_600_000);

export const importServerEvents = {
  /** A run's first attempt started reading (the worker's run start). */
  import_started: z.object({ provider, trigger }).strict(),
  /** A run finished (one per run; a DAILY run with nothing new is not a run and sends nothing). */
  import_finished: z
    .object({
      provider,
      trigger,
      imported: games,
      skipped: games,
      total: games,
      analysis_queued: games,
      duration_ms: ms,
      reading_ms: ms,
      saving_ms: ms,
      first_chunk_ms: ms.nullable(),
      upstream_requests: z.number().int().min(0).max(1_000),
      upstream_304_count: z.number().int().min(0).max(1_000),
    })
    .strict(),
  /** A run ended FAILED (terminal; the retries before it are not events). */
  import_failed: z.object({ provider, trigger, code: z.enum(IMPORT_EVENT_CODES), attempts: z.number().int().min(1).max(10) }).strict(),
  /** A 429 paused the provider gate during an import. */
  import_rate_limited: z.object({ provider, trigger, pause_sec: z.number().int().min(1).max(3_600) }).strict(),
  /** A paying member's import released backlog analyses (worker side of plan 8.9). */
  import_backlog_released: z.object({ games, slices: z.number().int().min(0).max(60), trigger: z.enum(["first_charge", "paid_initial"]) }).strict(),
  /** The first review of an INITIAL run is ready. */
  review_ready_after_import: z.object({ provider, ms_since_entitled: z.number().int().min(0).max(30 * 86_400_000) }).strict(),
  /** IMPORT_PURGE removed a member's imported games of one provider (plan 8.12). */
  account_purge_completed: z.object({ provider, games }).strict(),
} as const;

export const importEvents = { ...importServerEvents } as const;
