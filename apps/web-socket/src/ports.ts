// The socket server's ports: what the game core (src/game, src/commands, src/server) needs from logging, metrics,
// product telemetry and persistence, as interfaces. src/index.ts wires the real adapters; tests pass fakes.
//
// The adapters live in src/obs/{logger,metrics,sentry,posthog}.ts and src/persist/{outbox,journal}.ts; src/boot.ts
// wires them. Tests pass in-memory fakes (test/helpers.ts) behind the same interfaces.
import type { LiveGameRecord } from "@repo/db/live";
import type { AbortedBy, GameResult, JournalLine, Side, SocketErrorCode } from "@repo/game-core";
import type { LiveSession } from "./game/LiveSession";

// ── Logging ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Structured fields. Never user emails or tokens; refs and plies are fine (plan 10.2: `game`, `ply`, `user`, `phase`). */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields, error?: unknown): void;
}

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** One JSON line per entry on stdout/stderr (plan 10.2 "Logs are JSON"). */
export function createConsoleLogger(options: { level?: Level; base?: LogFields } = {}): Logger {
  const min = LEVELS[options.level ?? "info"];
  const write = (level: Level, message: string, fields?: LogFields, error?: unknown) => {
    if (LEVELS[level] < min) return;
    const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg: message, ...options.base, ...fields };
    if (error !== undefined) {
      entry.err = error instanceof Error ? { name: error.name, message: error.message } : String(error);
    }
    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f, e) => write("error", m, f, e),
  };
}

export const SILENT_LOGGER: Logger = { debug() {}, info() {}, warn() {}, error() {} };

// ── Metrics (plan 10.2; WP-D part 2 pushes them to Sentry every 60 s) ─────────────────────────────────────────
export type MetricTags = Record<string, string | number | boolean>;

export interface Metrics {
  count(name: string, tags?: MetricTags, value?: number): void;
  /** A duration or size sample (ms or bytes): p50/p99 come from the sink. */
  sample(name: string, value: number, tags?: MetricTags): void;
}

export const NOOP_METRICS: Metrics = { count() {}, sample() {} };

/** In-memory metrics for tests: `counts["ws.rate_limited{cmd=game:move}"]`. */
export function createMemoryMetrics(): Metrics & { counts: Map<string, number>; samples: Map<string, number[]> } {
  const key = (name: string, tags?: MetricTags) =>
    tags && Object.keys(tags).length
      ? `${name}{${Object.entries(tags)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(",")}}`
      : name;
  const counts = new Map<string, number>();
  const samples = new Map<string, number[]>();
  return {
    counts,
    samples,
    count(name, tags, value = 1) {
      const k = key(name, tags);
      counts.set(k, (counts.get(k) ?? 0) + value);
    },
    sample(name, value, tags) {
      const k = key(name, tags);
      const list = samples.get(k) ?? [];
      list.push(value);
      samples.set(k, list);
    },
  };
}

// ── Product telemetry (PostHog server events, plan 10.1) ─────────────────────────────────────────────────────
export type TelemetryProps = Record<string, string | number | boolean | null>;

export interface Telemetry {
  /** `distinctId` = the user's ref. Properties never carry FEN, PGN or move text. */
  capture(event: string, distinctId: string, props: TelemetryProps): void;
}

export const NOOP_TELEMETRY: Telemetry = { capture() {} };

// ── Persistence (plan 6.6, 7.6) ───────────────────────────────────────────────────────────────────────────────
export type RematchOutcome = { ok: true; newRef: string } | { ok: false; code: SocketErrorCode };

/** Outbox health for `/ready`, `/internal/metrics` and the metrics push (plan 7.5, 7.6). */
export interface OutboxStats {
  /** Games with changes the DB has not acknowledged (incl. a pending finish/abort). */
  depth: number;
  /** Age of the oldest unacknowledged change (ms); 0 when clean. */
  oldestMs: number;
  /** Epoch ms of the last successful DB statement; null before the first. */
  dbOkAt: number | null;
  /** Epoch ms of the last failed statement; null when none failed. */
  lastFailAt: number | null;
}

/**
 * Everything the live game core asks of storage. Every call except `load` and `createRematch` is fire-and-forget
 * from the game's point of view: play never waits on the database (plan 9.1 "no I/O in the move path").
 */
export interface LivePersistence {
  /** One statement (`loadLiveGame`); null when there is no such game. */
  load(ref: string): Promise<LiveGameRecord | null>;
  /** One journal line per machine transition (plan 7.6). */
  journal(session: LiveSession, line: JournalLine): void;
  /** A checkpoint opportunity (`move`, `phase`, `freeze`); the adapter decides when to write (B4: 10 plies / 15 s). */
  checkpoint(session: LiveSession, reason: "move" | "phase" | "freeze"): void;
  /** The finish CTE. Resolves when committed (or given up); the session then emits `game:result`. */
  finish(session: LiveSession, result: GameResult): Promise<{ committed: boolean }>;
  /** The abort statement (`ABORTED`, no stats). */
  abort(session: LiveSession, result: GameResult, abortedBy: AbortedBy): Promise<{ committed: boolean }>;
  /** `createRematch` after the parent's finish committed; colours swapped (plan 6.6.6). */
  createRematch(session: LiveSession, offeredBy: Side, acceptedBy: Side): Promise<RematchOutcome>;
  /** Plan 6.7 rule 4: a fire-and-forget `SELECT 1` when a game leaves waiting/study. */
  prewarm?(): void;
  /** The session is gone from memory (evicted). */
  forget?(ref: string): void;
  /** Shutdown: write every dirty game once and wait for writes in flight (bounded by the caller). */
  flushAll?(): Promise<void>;
  /** Outbox health (the outbox adapter; absent in memory fakes). */
  stats?(): OutboxStats;
}
