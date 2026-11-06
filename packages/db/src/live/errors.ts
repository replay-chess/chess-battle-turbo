// Surviving Neon scale-to-zero (phase-02 plan 6.7, feasibility F-OCI-4, api-perf AP-18).
//
// Neon suspends the compute after 5 minutes without queries and closes every client connection; the next statement
// then fails once. Prisma's query engine reconnects on its own, so a transient failure is retried ONCE at once (on
// the fresh connection the engine opens), then the caller's outbox backoff applies (1, 2, 4 … s). Every live
// statement is idempotent (the `plyCount <=` guard, the `status = 'IN_PROGRESS'` predicate), so the retry is safe.
// Transient failures count as `ws.persist.reconnect`, never `ws.persist.fail`.

/** Prisma error codes for a lost or refused connection. */
const TRANSIENT_PRISMA_CODES = new Set(["P1017", "P1001", "P1002", "P2024"]);
/** SQLSTATE: admin shutdown (Neon suspend / pg_terminate_backend), connection failure, connection does not exist. */
const TRANSIENT_SQLSTATES = new Set(["57P01", "57P02", "57P03", "08006", "08003", "08001", "08004"]);
/** Node socket errors. */
const TRANSIENT_ERRNOS = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]);
/** Message fragments the engine uses when it does not attach a code (raw queries wrap the server error in P2010). */
const TRANSIENT_MESSAGES = [
  /\b(57P0[123]|08006|08003|08001|08004)\b/,
  /\bECONNRESET\b/,
  /server has closed the connection/i,
  /terminating connection due to administrator command/i,
  /connection (?:was )?(?:closed|terminated|reset)/i,
  /can't reach database server/i,
  /Connection terminated unexpectedly/i,
];

interface ErrorLike {
  code?: unknown;
  errorCode?: unknown;
  meta?: { code?: unknown; message?: unknown } | null;
  message?: unknown;
  cause?: unknown;
}

/** The most specific code on an error: Prisma code, the SQLSTATE of a raw-query failure, or an errno. */
export function dbErrorCode(error: unknown): string | null {
  const e = error as ErrorLike | null;
  if (!e || typeof e !== "object") return null;
  const metaCode = e.meta && typeof e.meta.code === "string" ? e.meta.code : null;
  if (metaCode) return metaCode;
  if (typeof e.code === "string") return e.code;
  if (typeof e.errorCode === "string") return e.errorCode;
  return null;
}

/** True for a dropped or refused connection (retry once now, then back off). False for everything else. */
export function isTransientDbError(error: unknown, depth = 0): boolean {
  if (depth > 3 || error == null || typeof error !== "object") return false;
  const e = error as ErrorLike;
  const codes = [e.code, e.errorCode, e.meta?.code].filter((c): c is string => typeof c === "string");
  if (codes.some((c) => TRANSIENT_PRISMA_CODES.has(c) || TRANSIENT_SQLSTATES.has(c) || TRANSIENT_ERRNOS.has(c))) {
    return true;
  }
  // A known non-transient code (a unique violation, bad input, any other Prisma request error) is never retried.
  if (codes.some(isPermanentCode)) return false;
  const texts = [e.message, e.meta?.message].filter((t): t is string => typeof t === "string");
  for (const text of texts) {
    if (PERMANENT_SQLSTATE_IN_TEXT.test(text)) return false;
    if (TRANSIENT_MESSAGES.some((re) => re.test(text))) return true;
  }
  return isTransientDbError(e.cause, depth + 1);
}

/** SQLSTATE classes 22 (data exception) and 23 (integrity constraint) quoted in a raw-query error message. */
const PERMANENT_SQLSTATE_IN_TEXT = /\b2[23][0-9A-Z]{3}\b/;

function isPermanentCode(code: string): boolean {
  if (/^2[23][0-9A-Z]{3}$/.test(code)) return true; // SQLSTATE 22xxx / 23xxx
  // Prisma request errors, except P2010 (raw query failed: decided by the wrapped SQLSTATE) and P2024 (pool timeout).
  return /^P2\d{3}$/.test(code) && code !== "P2010" && code !== "P2024";
}

export interface TransientRetryOptions {
  /** Called once per transient failure that is retried (the socket counts `ws.persist.reconnect`). */
  onTransient?: (error: unknown) => void;
  /**
   * Drops the dead pool before the retry (`createPoolReset(db)`). Measured with Prisma 6.17.1 on Postgres 17: after
   * every pooled connection is terminated (what a Neon suspend does), the engine keeps answering P1017 "Server has
   * closed the connection" for ≈ 15 s, so a bare immediate retry fails again. `$disconnect()` lets in-flight
   * statements finish and makes the next statement open a fresh connection at once. Without `reset` the retry runs
   * on whatever the pool holds.
   */
  reset?: () => Promise<void>;
  /** Immediate retries on a transient error. Default 1 (plan 6.7: "retried once immediately"). */
  maxImmediateRetries?: number;
}

/**
 * Runs `fn`; on a transient error resets the pool (when `reset` is given) and runs it again immediately, up to
 * `maxImmediateRetries` times. A non-transient error, or a failure after the last retry, is thrown to the caller,
 * whose outbox applies the backoff (1, 2, 4 … s).
 */
export async function withTransientRetry<T>(fn: () => PromiseLike<T>, options: TransientRetryOptions = {}): Promise<T> {
  const max = options.maxImmediateRetries ?? 1;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= max || !isTransientDbError(error)) throw error;
      options.onTransient?.(error);
      if (options.reset) await options.reset().catch(() => undefined);
    }
  }
}

export interface DisconnectableClient {
  $disconnect(): Promise<void>;
}

/**
 * A single-flight pool reset for `withTransientRetry({ reset })`. Concurrent transient failures (every live game's
 * outbox hits the dead pool at once after a suspend) share one `$disconnect()`, and a reset within `minIntervalMs`
 * of the previous one is skipped, so a burst of failures cannot keep tearing the pool down.
 */
export function createPoolReset(db: DisconnectableClient, minIntervalMs = 1000, now: () => number = Date.now) {
  let inFlight: Promise<void> | null = null;
  let lastResetAt = Number.NEGATIVE_INFINITY;
  return function reset(): Promise<void> {
    if (inFlight) return inFlight;
    if (now() - lastResetAt < minIntervalMs) return Promise.resolve();
    inFlight = db
      .$disconnect()
      .catch(() => undefined)
      .finally(() => {
        lastResetAt = now();
        inFlight = null;
      });
    return inFlight;
  };
}
