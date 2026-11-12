// The worker's database client (phase-03 plan P3-D11, §9.8; FEA F-OCI-4, AP-18).
//
// - `neon`: @neondatabase/serverless `neon()` over HTTP for every statement against Neon. HTTP holds no idle
//   connection, so a Neon suspend cannot crash the worker; `batch()` sends a whole `sql.transaction([...])` in one
//   HTTP request (one Mumbai round trip).
// - `pg`: a plain Postgres (CI's service container, a local Docker Postgres for the `*.int.test.ts` files and the
//   e2e worker). The pool closes idle connections after 5 s and its `error` event is handled, so a server restart
//   between jobs is harmless.
//
// A network failure or a `57P01` (admin shutdown, e.g. a Neon suspend mid-request) is retried once, immediately; a
// second failure propagates. The failure is ambiguous: the server may have committed the first attempt and only the
// response was lost. Most worker statements are idempotent (upserts, `lockedBy`-guarded updates), so they are simply
// sent again. The two that are not carry their own retry form (`Statement.retry`):
//   - the claim (attempts + 1 on a new row) retries as "adopt the row my lost claim took, else claim" (claim.ts);
//   - the fail write (clears `lockedBy`) retries as "fail it, or confirm I already failed this attempt" (outcome.ts).
// A batch guarded by lockGuardStatement that committed before its response was lost fails on the retry with the lock
// guard's 22012; `wasRetried(error)` tells the caller to check whether its own first attempt committed (sql-store.ts).
// Statements return epoch milliseconds instead of timestamps (`extract(epoch …) * 1000`), so nothing depends on how a
// driver parses `timestamp without time zone` in the process time zone.
import { neon } from "@neondatabase/serverless";
import pg from "pg";
import type { Logger } from "../obs/log";

export interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
  /**
   * What an ambiguous failure (see the header) sends again: omitted = the same statement (it is idempotent), a
   * statement = that one instead (the retry form of a statement that is not idempotent), "never" = no retry.
   */
  readonly retry?: Statement | "never";
}

const RETRIED = Symbol("rc.db.retried");

/** Whether an error came from the retry of an ambiguous failure (the first attempt may have committed). */
export function wasRetried(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { [RETRIED]?: boolean })[RETRIED] === true;
}

/** The statements an ambiguous failure of `ss` sends again, or null when one of them must never be repeated. */
export function retryForm(ss: readonly Statement[]): Statement[] | null {
  const out: Statement[] = [];
  for (const s of ss) {
    if (s.retry === "never") return null;
    out.push(s.retry ?? s);
  }
  return out;
}

export type Row = Record<string, unknown>;

/** A statement from text with `$n` placeholders. */
export function stmt(text: string, values: readonly unknown[] = []): Statement {
  return { text, values };
}

/** A `Prisma.Sql` built by @repo/db (its `.text` uses `$n` placeholders). */
export function fromPrisma(sql: { text: string; values: unknown[] }): Statement {
  return { text: sql.text, values: sql.values };
}

export interface Db {
  /** One statement, one round trip. */
  query<R extends Row = Row>(s: Statement): Promise<R[]>;
  /** Several statements in one transaction and one round trip; the rows of each, in order. */
  batch(ss: readonly Statement[]): Promise<Row[][]>;
  close(): Promise<void>;
}

/** The transport underneath (one call = one round trip). */
export interface Driver {
  run(ss: readonly Statement[], transaction: boolean): Promise<Row[][]>;
  close(): Promise<void>;
}

export interface DbCounters {
  /** Round trips (a batch is one). The timer audit (§12.1) counts these. */
  roundTrips: number;
  statements: number;
  retries: number;
}

function normalise(values: readonly unknown[]): unknown[] {
  return values.map((v) => (typeof v === "bigint" ? v.toString() : v));
}

const RETRY_SQLSTATES = new Set(["57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"]);
const RETRY_ERRNO = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH"]);

/** A transient failure that an immediate retry may get past (the statement was idempotent). */
export function isRetryableDbError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown; sourceError?: unknown; name?: unknown };
  if (typeof e.code === "string" && (RETRY_SQLSTATES.has(e.code) || RETRY_ERRNO.has(e.code) || e.code.startsWith("UND_ERR"))) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  if (/fetch failed|Error connecting to database|Connection terminated|socket hang up|other side closed/i.test(message)) {
    return true;
  }
  return isRetryableDbError(e.cause, depth + 1) || isRetryableDbError(e.sourceError, depth + 1);
}

/** Wraps a driver with the retry rule and the counters. */
export class CountingDb implements Db {
  readonly counters: DbCounters = { roundTrips: 0, statements: 0, retries: 0 };

  constructor(
    private readonly driver: Driver,
    private readonly log?: Logger,
    private readonly onCount?: (c: DbCounters) => void,
  ) {}

  private async run(ss: readonly Statement[], transaction: boolean): Promise<Row[][]> {
    const prepare = (list: readonly Statement[]) => list.map((s) => ({ text: s.text, values: normalise(s.values) }));
    let current = ss;
    for (let attempt = 1; ; attempt++) {
      this.counters.roundTrips++;
      this.counters.statements += current.length;
      this.onCount?.(this.counters);
      try {
        return await this.driver.run(prepare(current), transaction);
      } catch (error) {
        const again = attempt === 1 && isRetryableDbError(error) ? retryForm(current) : null;
        if (again) {
          this.counters.retries++;
          this.onCount?.(this.counters);
          this.log?.warn("db retry", { error });
          current = again;
          continue;
        }
        if (attempt > 1 && typeof error === "object" && error !== null) {
          Object.defineProperty(error, RETRIED, { value: true, enumerable: false });
        }
        throw error;
      }
    }
  }

  async query<R extends Row = Row>(s: Statement): Promise<R[]> {
    const [rows] = await this.run([s], false);
    return (rows ?? []) as R[];
  }

  async batch(ss: readonly Statement[]): Promise<Row[][]> {
    if (ss.length === 0) return [];
    return this.run(ss, true);
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}

/** Neon over HTTP (P3-D11). */
export function neonDriver(url: string): Driver {
  const sql = neon(url, { fullResults: false, arrayMode: false });
  return {
    async run(ss, transaction) {
      if (ss.length === 1 && !transaction) {
        const s = ss[0]!;
        return [(await sql.query(s.text, [...s.values])) as Row[]];
      }
      const results = await sql.transaction(ss.map((s) => sql.query(s.text, [...s.values])));
      return results as Row[][];
    },
    async close() {
      // HTTP: nothing is held open.
    },
  };
}

/** A plain Postgres through `pg` (CI and local Docker). */
export function pgDriver(url: string, log?: Logger): Driver {
  const pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 5_000, allowExitOnIdle: true });
  pool.on("error", (error) => log?.warn("pg idle client error", { error }));
  return {
    async run(ss, transaction) {
      if (ss.length === 1 && !transaction) {
        const s = ss[0]!;
        return [(await pool.query(s.text, [...s.values])).rows as Row[]];
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out: Row[][] = [];
        for (const s of ss) out.push((await client.query(s.text, [...s.values])).rows as Row[]);
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function createDb(
  opts: { url: string; driver: "neon" | "pg" },
  log?: Logger,
  onCount?: (c: DbCounters) => void,
): CountingDb {
  const driver = opts.driver === "neon" ? neonDriver(opts.url) : pgDriver(opts.url, log);
  return new CountingDb(driver, log, onCount);
}

// ── Row helpers (drivers return int8 as string, float8 as number) ───────────────────────────────────────────────
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`expected a number, got ${typeof v}`);
  return n;
}

export function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

/** An int8 id as its decimal string. */
export function idStr(v: unknown): string {
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  if (typeof v === "bigint") return v.toString();
  throw new TypeError("expected an int8 id");
}

export function idOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : idStr(v);
}
