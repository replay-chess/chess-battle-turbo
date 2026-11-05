// Per-request timing and DB accounting (plan §7.2 steps 8 and 11, OPT §9.1).
//
// route() opens a RequestStore in AsyncLocalStorage; the Prisma query extension in lib/prisma.ts calls recordQuery()
// for every statement, so the wrapper knows the request's DB time, statement count and write count without passing
// anything around. GET purity reads the write count. Statements the wrapper itself runs (the rate limiter's upsert)
// are wrapped in exemptWrites(): they add to time and statement count but are not handler writes.
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestStore = {
  dbMs: number;
  dbStatements: number;
  /** INSERT/UPDATE/DELETE statements outside exemptWrites(). */
  writes: number;
  /** Operation names of the writes, for the get_wrote report (bounded). */
  writeOps: string[];
};

type Frame = { root: RequestStore; exemptWrites: boolean };

const als = new AsyncLocalStorage<Frame>();

export function createRequestStore(): RequestStore {
  return { dbMs: 0, dbStatements: 0, writes: 0, writeOps: [] };
}

export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return als.run({ root: store, exemptWrites: false }, fn);
}

export function getRequestStore(): RequestStore | undefined {
  return als.getStore()?.root;
}

/** Runs fn in the same store, but its statements don't count as writes (wrapper-owned statements). */
export function exemptWrites<T>(fn: () => T): T {
  const frame = als.getStore();
  if (!frame) return fn();
  return als.run({ root: frame.root, exemptWrites: true }, fn);
}

const MAX_WRITE_OPS = 10;

/** Called by the Prisma extension once per statement. No-op outside a request. */
export function recordQuery(durationMs: number, write: boolean, operation: string): void {
  const frame = als.getStore();
  if (!frame) return;
  const store = frame.root;
  store.dbMs += durationMs;
  store.dbStatements += 1;
  if (write && !frame.exemptWrites) {
    store.writes += 1;
    if (store.writeOps.length < MAX_WRITE_OPS) store.writeOps.push(operation);
  }
}

// ---------------------------------------------------------------------------
// Write classification

const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

const RAW_OPERATIONS: ReadonlySet<string> = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

/** The SQL text of a raw-operation argument (Prisma.Sql, template strings array, or [sql, ...values]). */
export function sqlTextOf(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) {
    const first: unknown = args[0];
    if (typeof first === "string") return first;
    if (Array.isArray(first)) return (first as unknown[]).filter((s) => typeof s === "string").join("?");
    if (first && typeof first === "object") return sqlTextOf(first);
    return "";
  }
  if (args && typeof args === "object") {
    const a = args as { sql?: unknown; text?: unknown; strings?: unknown };
    if (typeof a.sql === "string") return a.sql;
    if (typeof a.text === "string") return a.text;
    if (Array.isArray(a.strings)) return (a.strings as unknown[]).filter((s) => typeof s === "string").join("?");
  }
  return "";
}

/** True when SQL text modifies data (INSERT/UPDATE/DELETE/MERGE/TRUNCATE, also inside a WITH). */
export function isWriteSql(sql: string): boolean {
  const text = sql.replace(/--[^\n]*\n/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  const first = /^\(?\s*([A-Za-z]+)/.exec(text)?.[1]?.toUpperCase();
  if (!first) return false;
  if (["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE"].includes(first)) return true;
  if (first === "WITH") return /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|MERGE\s+INTO)\b/i.test(text);
  return false;
}

/** Whether one Prisma operation writes. Raw statements are classified by their SQL. */
export function isWriteOperation(operation: string, args: unknown): boolean {
  if (WRITE_OPERATIONS.has(operation)) return true;
  if (RAW_OPERATIONS.has(operation)) return isWriteSql(sqlTextOf(args));
  return false;
}

// ---------------------------------------------------------------------------
// Server-Timing

export type TimingSegment = { name: string; dur: number };

const SEGMENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** A small stopwatch: mark(name) closes the segment that started at the previous mark. */
export function createTimer(clock: () => number = () => performance.now()) {
  const started = clock();
  let last = started;
  const segments: TimingSegment[] = [];
  return {
    /** Records the time since the previous mark (or the start) under `name`. */
    mark(name: string): void {
      const now = clock();
      if (SEGMENT_NAME.test(name)) segments.push({ name, dur: now - last });
      last = now;
    },
    /** Adds a segment measured elsewhere (e.g. db time from the store). */
    add(name: string, dur: number): void {
      if (SEGMENT_NAME.test(name)) segments.push({ name, dur });
    },
    elapsed(): number {
      return clock() - started;
    },
    segments(): TimingSegment[] {
      return segments.slice();
    },
  };
}

export type Timer = ReturnType<typeof createTimer>;

/** `auth;dur=1.2, rl;dur=0.4, …`. Durations rounded to 0.1 ms; repeated names are summed. */
export function serverTimingHeader(segments: readonly TimingSegment[]): string {
  const totals = new Map<string, number>();
  for (const s of segments) totals.set(s.name, (totals.get(s.name) ?? 0) + Math.max(0, s.dur));
  return Array.from(totals, ([name, dur]) => `${name};dur=${Math.round(dur * 10) / 10}`).join(", ");
}
