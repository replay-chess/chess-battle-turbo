// The database seam of the Train services (phase-05 plan §7.3; opt §3.1). Every P5 statement is a Prisma.Sql sent
// through rawDb() (the *Unsafe path every web caller uses, lib/games/snapshot.server.ts), so the same service runs on
// the pooled client, inside an interactive transaction, or on a test database.
//
// Time: P5 tables keep UTC in `timestamp(3) without time zone`. Every business instant is the request clock `now`
// (ctx.now / requestNow(), x-rc-now aware), bound as an ISO string and converted with `AT TIME ZONE 'UTC'` (`at()`),
// so nothing depends on the session TimeZone and SQL never reads now() except for the audit columns.
import { Prisma } from "@repo/db";
import { rawDb, type GamesDb } from "@/lib/games/snapshot.server";
import { prisma } from "@/lib/prisma";

export type TrainDb = GamesDb;

/** Runs `fn` in one interactive transaction (opt §3.1 rule 4: tx-scoped client only, bounded waits). */
export type TrainTx = <T>(fn: (db: TrainDb) => Promise<T>) => Promise<T>;

/** W1's budget (plan §7.3): wait ≤ 2 s for a connection, ≤ 5 s for the whole transaction. */
export const TRAIN_TX_OPTIONS = { maxWait: 2_000, timeout: 5_000 } as const;

export type TrainDeps = { db: TrainDb; tx: TrainTx };

/** The pooled client and its transaction runner. */
export function trainDeps(): TrainDeps {
  return {
    db: rawDb(prisma),
    tx: (fn) => prisma.$transaction((client) => fn(rawDb(client)), TRAIN_TX_OPTIONS),
  };
}

/** The database clock for audit columns (`createdAt`, `updatedAt`), in UTC like every timestamp(3) column. */
export const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** A UTC instant as a `timestamp(3)` value. */
export function at(d: Date): Prisma.Sql {
  return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** A local training day key ("YYYY-MM-DD") as a `date`. */
export function dayParam(key: string): Prisma.Sql {
  return Prisma.sql`${key}::date`;
}

/** A driver timestamp (Date, or an ISO string from a json_build_object) as a Date; null stays null. */
export function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** `to_char(ts, …)` of a UTC timestamp(3) column as an ISO instant, for json_build_object. */
export function isoOf(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

export const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));

// ── Per-member transaction locks (FIX-1: check-then-insert races) ──────────────────────────────────────────────────
/** Lock namespaces (the first key of `pg_advisory_xact_lock(int, int)`). */
export const LOCK_TRAIN_SESSION = 5_001;
export const LOCK_REPORT = 5_002;
/** W1: a member's attempt batches apply one at a time (FIX-2: two overlapping flushes). */
export const LOCK_TRAIN_ATTEMPTS = 5_003;

/**
 * A transaction-scoped lock per member and purpose: the member's concurrent session creates (or reports) run one at a
 * time, so a "read the count, then insert" rule holds under concurrency. Released at commit or rollback.
 */
export function memberLockSql(namespace: number, userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(${namespace}::int, ${Number(userId % 2_147_483_647n)}::int)`;
}
