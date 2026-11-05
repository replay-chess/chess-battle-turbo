/**
 * Postgres fixed-window rate limiter (Phase 1 plan §8.1).
 *
 * One statement per check, race-free under concurrency: the row lock taken by
 * `INSERT … ON CONFLICT DO UPDATE` serialises concurrent hits on the same key.
 * Two stores share that statement:
 *
 * - `burst`   → UNLOGGED `rate_limit_buckets`, windows ≤ 300 s only. Neon empties
 *               unlogged tables when a compute restarts, but it suspends only after
 *               300 s without queries, so a short window has expired by then anyway.
 * - `durable` → LOGGED `rate_limit_windows`, for anything longer (an hour, a day).
 *
 * A `burst` spec with `windowSec > 300` throws when it is defined, which is at
 * module load for every route that declares it. Daily or monthly budgets (emails
 * sent, coach spend) are not rate limits: count the source rows instead.
 *
 * The limiter fails open: a database error allows the request, is logged and metered.
 * Nothing in this module runs at import time except spec validation, so the pure
 * parts are unit-tested without a database (`rate-limit-db.test.ts`).
 */
import { createHash, createHmac } from "node:crypto";

export type RateLimitStore = "burst" | "durable";
export type RateLimitBy = "user" | "ip" | "user+ip";

/** Structurally identical to `RateLimitSpec` in `@repo/contracts/http/endpoint`. */
export type RateLimitSpec = {
  /** Lowercase bucket name, e.g. `billing-refresh`. */
  bucket: string;
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. Always written `limit / windowSec`. */
  windowSec: number;
  by: RateLimitBy;
  /** Default `burst`. `burst` with `windowSec > 300` throws. */
  store?: RateLimitStore;
};

/** Longest window the UNLOGGED burst store may hold (Neon's suspend delay). */
export const BURST_MAX_WINDOW_SEC = 300;

const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class RateLimitSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitSpecError";
  }
}

export function storeFor(spec: Pick<RateLimitSpec, "store">): RateLimitStore {
  return spec.store ?? "burst";
}

/** Throws a `RateLimitSpecError` when the spec breaks a rule; returns nothing otherwise. */
export function assertRateLimitSpec(spec: RateLimitSpec): void {
  if (!BUCKET_NAME.test(spec.bucket)) {
    throw new RateLimitSpecError(
      `rate limit bucket "${spec.bucket}" must be 1-40 chars of a-z, 0-9 and "-"`,
    );
  }
  if (!Number.isInteger(spec.limit) || spec.limit < 1) {
    throw new RateLimitSpecError(`rate limit "${spec.bucket}": limit must be a positive integer`);
  }
  if (!Number.isInteger(spec.windowSec) || spec.windowSec < 1) {
    throw new RateLimitSpecError(`rate limit "${spec.bucket}": windowSec must be a positive integer`);
  }
  if (spec.by !== "user" && spec.by !== "ip" && spec.by !== "user+ip") {
    throw new RateLimitSpecError(`rate limit "${spec.bucket}": unknown by "${String(spec.by)}"`);
  }
  const store = storeFor(spec);
  if (store !== "burst" && store !== "durable") {
    throw new RateLimitSpecError(`rate limit "${spec.bucket}": unknown store "${String(store)}"`);
  }
  if (store === "burst" && spec.windowSec > BURST_MAX_WINDOW_SEC) {
    throw new RateLimitSpecError(
      `rate limit "${spec.bucket}": a burst window must be ≤ ${BURST_MAX_WINDOW_SEC} s (got ${spec.windowSec} s); use store "durable"`,
    );
  }
}

/** Validates a spec and returns it unchanged. Call it at module scope so a bad spec fails the import. */
export function defineRateLimit<const S extends RateLimitSpec>(spec: S): S {
  assertRateLimitSpec(spec);
  return spec;
}

/** Phase 1 buckets (plan §8.1). Later phases add theirs with `defineRateLimit` next to the route. */
export const RATE_LIMITS = {
  billingRefresh: defineRateLimit({ bucket: "billing-refresh", limit: 10, windowSec: 60, by: "user", store: "burst" }),
  healthDeep: defineRateLimit({ bucket: "health-deep", limit: 6, windowSec: 60, by: "ip", store: "burst" }),
} as const;

// ---------------------------------------------------------------------------
// SQL

export const RATE_LIMIT_TABLES = {
  burst: "rate_limit_buckets",
  durable: "rate_limit_windows",
} as const satisfies Record<RateLimitStore, string>;

export function tableFor(store: RateLimitStore): (typeof RATE_LIMIT_TABLES)[RateLimitStore] {
  return RATE_LIMIT_TABLES[store];
}

function upsertSql(table: string): string {
  return `INSERT INTO "${table}" AS b ("key", "count", "resetAt")
VALUES ($1, 1, (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int))
ON CONFLICT ("key") DO UPDATE SET
  "count"   = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC') THEN 1 ELSE b."count" + 1 END,
  "resetAt" = CASE WHEN b."resetAt" <= (now() AT TIME ZONE 'UTC')
                   THEN (now() AT TIME ZONE 'UTC') + make_interval(secs => $2::int) ELSE b."resetAt" END
RETURNING "count", "resetAt"`;
}

/**
 * The limiter statement per store. `$1` key, `$2` window seconds. The table name
 * is a constant chosen by the store, never user input.
 */
export const RATE_LIMIT_SQL: Readonly<Record<RateLimitStore, string>> = Object.freeze({
  burst: upsertSql(RATE_LIMIT_TABLES.burst),
  durable: upsertSql(RATE_LIMIT_TABLES.durable),
});

// ---------------------------------------------------------------------------
// Pure decision helpers (mirror the SQL; unit tested)

export type WindowRow = { count: number; resetAt: Date };

export type WindowDecision = WindowRow & { allowed: boolean; retryAfterSec: number };

/** `retryAfterSec = max(1, ceil((resetAt − now) / 1000))`. */
export function retryAfterSeconds(resetAt: Date, now: Date): number {
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
}

/** Allowed or denied from the row the statement RETURNs (the count already includes this hit). */
export function evaluateRow(row: WindowRow, now: Date, limit: number): WindowDecision {
  const allowed = row.count <= limit;
  return {
    count: row.count,
    resetAt: row.resetAt,
    allowed,
    retryAfterSec: allowed ? 0 : retryAfterSeconds(row.resetAt, now),
  };
}

/**
 * What the upsert does to `row` (the stored row before this hit, or null), then
 * the decision. Mirrors the SQL exactly; used by tests and by anything that
 * needs the arithmetic without a database.
 */
export function decideWindow(
  row: WindowRow | null,
  now: Date,
  limit: number,
  windowSec: number,
): WindowDecision {
  const fresh = new Date(now.getTime() + windowSec * 1000);
  const next: WindowRow =
    !row || row.resetAt.getTime() <= now.getTime()
      ? { count: 1, resetAt: fresh }
      : { count: row.count + 1, resetAt: row.resetAt };
  return evaluateRow(next, now, limit);
}

// ---------------------------------------------------------------------------
// Keys

export type RateLimitSubject = {
  /** Clerk user id from the JWT (available before the viewer read). */
  clerkUserId?: string | null;
  /** Client IP (first hop of `x-forwarded-for` on Vercel). */
  ip?: string | null;
};

/** `hex(sha256(pepper ‖ ip))[0:16]`: the raw IP never reaches the database. */
export function hashIp(ip: string, pepper: string): string {
  return createHash("sha256").update(pepper).update(ip).digest("hex").slice(0, 16);
}

export function userKey(bucket: string, clerkUserId: string): string {
  return `rl:${bucket}:c:${clerkUserId}`;
}

export function ipKey(bucket: string, ip: string, pepper: string): string {
  return `rl:${bucket}:ip:${hashIp(ip, pepper)}`;
}

/**
 * Keys a spec checks for a subject. `user` falls back to the IP when there is no
 * Clerk user (an anonymous caller is still limited); `user+ip` checks both and is
 * denied when either is. No key at all → nothing to check (allowed).
 */
export function keysFor(spec: RateLimitSpec, subject: RateLimitSubject, pepper: string): string[] {
  const user = subject.clerkUserId?.trim() || null;
  const ip = subject.ip?.trim() || null;
  const keys: string[] = [];
  if (spec.by === "user") {
    if (user) keys.push(userKey(spec.bucket, user));
    else if (ip) keys.push(ipKey(spec.bucket, ip, pepper));
  } else if (spec.by === "ip") {
    if (ip) keys.push(ipKey(spec.bucket, ip, pepper));
  } else {
    if (user) keys.push(userKey(spec.bucket, user));
    if (ip) keys.push(ipKey(spec.bucket, ip, pepper));
  }
  return keys;
}

/** First hop of `x-forwarded-for`, else `x-real-ip`, else null. */
export function clientIpFrom(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return headers.get("x-real-ip")?.trim() || null;
}

// ---------------------------------------------------------------------------
// Check

export type RateLimitDecision = {
  allowed: boolean;
  /** 0 when allowed; ≥ 1 when denied (the longest wait across the denied keys). */
  retryAfterSec: number;
  /** The bucket that denied (the one with the longest wait), when denied. */
  bucket?: string;
  /** True when a database error made the limiter allow the request. */
  failedOpen?: boolean;
};

export type RateLimitQuery = (sql: string, key: string, windowSec: number) => Promise<WindowRow[]>;

export type RateLimitDeps = {
  query?: RateLimitQuery;
  now?: () => Date;
  pepper?: string;
  onError?: (err: unknown, bucket: string) => void;
};

const defaultQuery: RateLimitQuery = async (sql, key, windowSec) => {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$queryRawUnsafe<WindowRow[]>(sql, key, windowSec);
};

function defaultOnError(err: unknown, bucket: string): void {
  void (async () => {
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureMessage("rate_limit_unavailable", {
        level: "warning",
        tags: { bucket },
        extra: { error: err instanceof Error ? err.message : String(err) },
      });
      Sentry.metrics.count("rate_limited.error", 1, { attributes: { bucket } });
    } catch {
      // telemetry must never break the request
    }
  })();
}

export type PepperSource = "configured" | "derived" | "none";

/**
 * The secret mixed into IP keys (plan §8.1, §11.3: raw IPs must never be recoverable from the database).
 * `RATE_LIMIT_IP_PEPPER` when set. Otherwise a fail-safe instead of an unsalted hash (which a brute force over
 * the IPv4 space reverses): a pepper derived with HMAC from a server secret every deployment has
 * (`CLERK_SECRET_KEY`, else `INTERNAL_API_SECRET`), stable across instances. Either fallback is reported once.
 * Only with no secret at all (unit tests, a bare local run) is the pepper empty.
 */
export function resolveIpPepper(
  env: Readonly<Record<string, string | undefined>> = process.env,
  onFallback: (source: Exclude<PepperSource, "configured">) => void = () => {},
): string {
  const configured = env.RATE_LIMIT_IP_PEPPER;
  if (configured) return configured;
  const base = env.CLERK_SECRET_KEY || env.INTERNAL_API_SECRET;
  if (base) {
    onFallback("derived");
    return createHmac("sha256", base).update("replay-chess/rate-limit-ip-pepper/v1").digest("hex");
  }
  onFallback("none");
  return "";
}

function reportPepperFallback(source: Exclude<PepperSource, "configured">): void {
  void (async () => {
    try {
      const { logger } = await import("@/lib/logger");
      logger.warn(
        source === "derived"
          ? "RATE_LIMIT_IP_PEPPER is not set; IP rate-limit keys use a pepper derived from a server secret"
          : "RATE_LIMIT_IP_PEPPER is not set and no server secret is available; IP rate-limit keys are unpeppered",
      );
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureMessage("rate_limit_ip_pepper_missing", { level: "warning", tags: { source } });
    } catch {
      // telemetry must never break the request
    }
  })();
}

let cachedPepper: string | undefined;

function ipPepper(): string {
  // RATE_LIMIT_IP_PEPPER joins REPO/turbo.json `globalEnv` with 1B·F7 (plan §7.9).
  cachedPepper ??= resolveIpPepper(process.env, reportPepperFallback);
  return cachedPepper;
}

/**
 * Runs every key of every spec (in parallel) and denies when any key is over its
 * limit. Fails open per key on database errors.
 */
export async function checkRateLimit(
  specs: RateLimitSpec | readonly RateLimitSpec[],
  subject: RateLimitSubject,
  deps: RateLimitDeps = {},
): Promise<RateLimitDecision> {
  const list: readonly RateLimitSpec[] = Array.isArray(specs) ? specs : [specs as RateLimitSpec];
  const query = deps.query ?? defaultQuery;
  const now = deps.now ?? (() => new Date());
  const pepper = deps.pepper ?? ipPepper();
  const onError = deps.onError ?? defaultOnError;

  const checks = list.flatMap((spec) => {
    assertRateLimitSpec(spec);
    const sql = RATE_LIMIT_SQL[storeFor(spec)];
    return keysFor(spec, subject, pepper).map(async (key) => {
      try {
        const rows = await query(sql, key, spec.windowSec);
        const row = rows[0];
        if (!row) throw new Error("rate limit statement returned no row");
        const decision = evaluateRow(
          { count: Number(row.count), resetAt: new Date(row.resetAt) },
          now(),
          spec.limit,
        );
        return { bucket: spec.bucket, decision, failed: false };
      } catch (err) {
        onError(err, spec.bucket);
        return { bucket: spec.bucket, decision: null, failed: true };
      }
    });
  });

  const results = await Promise.all(checks);
  let denied: { bucket: string; retryAfterSec: number } | null = null;
  let failedOpen = false;
  for (const r of results) {
    if (r.failed) failedOpen = true;
    if (r.decision && !r.decision.allowed) {
      if (!denied || r.decision.retryAfterSec > denied.retryAfterSec) {
        denied = { bucket: r.bucket, retryAfterSec: r.decision.retryAfterSec };
      }
    }
  }
  if (denied) return { allowed: false, retryAfterSec: denied.retryAfterSec, bucket: denied.bucket };
  return failedOpen ? { allowed: true, retryAfterSec: 0, failedOpen: true } : { allowed: true, retryAfterSec: 0 };
}
