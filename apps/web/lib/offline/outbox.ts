// The training outbox (phase-05 plan §5.4, cdl §7.4): graded attempts are written to IndexedDB **before** the runner
// advances, then sent to W1 `POST /api/train/attempts` in batches, exactly once, from one tab at a time.
//
//   database  rc-outbox · store items · key u:<userRef>:attempts  → OutboxEntry[]   (idb-keyval, ≈ 0.6 kB gz)
//
// - Durable first: `enqueue()` resolves after the IndexedDB transaction committed (memory fallback when IndexedDB is
//   missing, e.g. a private window that blocks it: the session still works, a reload loses the queue).
// - At most `OUTBOX_CAP` (500) entries per user; the oldest go first when it overflows. Entries older than 14 days are
//   sent with `stale: true` and the server answers `rejected/too_old` (§5.4 step 6).
// - One tab flushes at a time: `navigator.locks.request("rc-outbox:<userRef>", {ifAvailable: true})`; a tab that does
//   not get the lock skips (the holder sends everything). Batches ≤ 50, sorted by `reviewedAt`, so the server replays
//   them in order with `now = reviewedAt` (arch §2.3.5).
// - Every per-attempt result is terminal (`ok`, `duplicate`, `conflict`, `rejected`): the entry leaves the queue. A
//   whole-batch 402 stops and keeps everything (attempts up to 7 days old are accepted after renewal); 401 keeps them
//   for after the silent session refresh; network, 5xx and 429 keep them and retry 1 s → 4 s → 15 s, then on
//   `online` / visible / mount. A 4xx that rejects the batch body is split into single attempts so one bad entry can
//   never block the queue; a single that is still refused is dropped with a breadcrumb.
// - The scheduler flushes when ≥ 3 entries wait, 4 s after the last enqueue, on session end, on hidden/pagehide
//   (keepalive, < 60 KB) and on online/mount (`useOutboxSync()` in the (app) layout).
//
// Pure of React: storage, locks, timers and the sender are injectable (outbox.test.ts runs it on fake-indexeddb).
import type { AttemptIn, AttemptOut, AttemptsResult } from "@repo/contracts/http/train";
import { clear, createStore, del, get, promisifyRequest, type UseStore } from "idb-keyval";

export const OUTBOX_DB = "rc-outbox";
export const OUTBOX_STORE = "items";
/** Entries kept per user (§5.4 step 6). */
export const OUTBOX_CAP = 500;
/** W1 accepts at most this many attempts per request (= `ATTEMPTS_BATCH_MAX`, asserted in outbox.test.ts). */
export const OUTBOX_BATCH_MAX = 50;
/** Older entries are sent with `stale: true` (the server answers rejected/too_old). */
export const STALE_AFTER_MS = 14 * 86_400_000;
/** Flush as soon as this many entries wait … */
export const FLUSH_AT_COUNT = 3;
/** … or this long after the last enqueue. */
export const FLUSH_DEBOUNCE_MS = 4_000;
/** Retries after a network/5xx failure; then the next online / visible / mount event. */
export const RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const;

export type OutboxKind = "attempts";
export type OutboxEntry = { id: string; at: number; attempt: AttemptIn };

/** `u:<userRef>:attempts`. */
export function outboxKey(userRef: string, kind: OutboxKind = "attempts"): string {
  return `u:${userRef}:${kind}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OutboxStorage {
  read(key: string): Promise<OutboxEntry[]>;
  /** Atomic read-modify-write (one IndexedDB transaction). Returns the stored list. */
  mutate(key: string, fn: (entries: OutboxEntry[]) => OutboxEntry[]): Promise<OutboxEntry[]>;
  remove(key: string): Promise<void>;
  /** Every key (every member's queue): a sign-out in a tab that does not know whose queue it holds (FIX-2). */
  removeAll(): Promise<void>;
}

export function memoryStorage(): OutboxStorage {
  const data = new Map<string, OutboxEntry[]>();
  return {
    async read(key) {
      return [...(data.get(key) ?? [])];
    },
    async mutate(key, fn) {
      const next = fn([...(data.get(key) ?? [])]);
      if (next.length) data.set(key, next);
      else data.delete(key);
      return [...next];
    },
    async remove(key) {
      data.delete(key);
    },
    async removeAll() {
      data.clear();
    },
  };
}

export function idbStorage(store: UseStore = createStore(OUTBOX_DB, OUTBOX_STORE)): OutboxStorage {
  return {
    async read(key) {
      const v = await get<OutboxEntry[]>(key, store);
      return Array.isArray(v) ? v : [];
    },
    async mutate(key, fn) {
      // ONE readwrite transaction: read, then put the new list or delete the key (FIX-2). Emptying the queue used to
      // write `undefined` in one transaction and delete in a second, so an enqueue that committed between the two was
      // deleted with it: a graded attempt lost silently.
      let out: OutboxEntry[] = [];
      await store("readwrite", (s) =>
        new Promise<void>((resolve, reject) => {
          const req = s.get(key);
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            try {
              const old = req.result as unknown;
              out = fn(Array.isArray(old) ? (old as OutboxEntry[]) : []);
              if (out.length) s.put(out, key);
              else s.delete(key);
              resolve(promisifyRequest(s.transaction));
            } catch (err) {
              reject(err);
            }
          };
        }),
      );
      return out;
    },
    async remove(key) {
      await del(key, store);
    },
    async removeAll() {
      await clear(store);
    },
  };
}

let defaultStorage: OutboxStorage | null = null;

/** IndexedDB when the browser has it, else memory (SSR never calls this). */
export function getOutboxStorage(): OutboxStorage {
  if (defaultStorage) return defaultStorage;
  defaultStorage = typeof indexedDB === "undefined" ? memoryStorage() : resilient(idbStorage(), memoryStorage());
  return defaultStorage;
}

/** Test seam. */
export function setOutboxStorage(s: OutboxStorage | null): void {
  defaultStorage = s;
}

/** IndexedDB that falls back to memory for good after the first failure (a blocked or full database). */
function resilient(primary: OutboxStorage, fallback: OutboxStorage): OutboxStorage {
  let failed = false;
  const run = async <T>(fn: (s: OutboxStorage) => Promise<T>): Promise<T> => {
    if (!failed) {
      try {
        return await fn(primary);
      } catch {
        failed = true;
      }
    }
    return fn(fallback);
  };
  return {
    read: (k) => run((s) => s.read(k)),
    mutate: (k, f) => run((s) => s.mutate(k, f)),
    remove: (k) => run((s) => s.remove(k)),
    removeAll: async () => {
      // Both: a queue may sit in memory after IndexedDB failed, or in IndexedDB from an earlier page load.
      await Promise.allSettled([primary.removeAll(), fallback.removeAll()]);
    },
  };
}

// ── The cheap "anything queued?" hint (localStorage), so the (app) layout loads this module only when needed ─────
export function hintKey(userRef: string): string {
  return `rc.outbox.${userRef}`;
}

function writeHint(userRef: string, n: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (n > 0) localStorage.setItem(hintKey(userRef), String(n));
    else localStorage.removeItem(hintKey(userRef));
  } catch {
    // Storage blocked: the layout then checks IndexedDB on mount instead.
  }
}

// ── Queue operations ─────────────────────────────────────────────────────────────────────────────────────────────
/** Adds one attempt (durable before it resolves). Returns how many entries wait. */
export async function enqueueAttempt(userRef: string, attempt: AttemptIn, opts: { storage?: OutboxStorage; now?: number } = {}): Promise<number> {
  const storage = opts.storage ?? getOutboxStorage();
  const entry: OutboxEntry = { id: attempt.clientAttemptId, at: opts.now ?? Date.now(), attempt };
  const stored = await storage.mutate(outboxKey(userRef), (list) => {
    const next = list.filter((e) => e.id !== entry.id);
    next.push(entry);
    return next.length > OUTBOX_CAP ? next.slice(next.length - OUTBOX_CAP) : next;
  });
  writeHint(userRef, stored.length);
  emit(userRef, { type: "change", pending: stored.length });
  return stored.length;
}

export async function pendingAttempts(userRef: string, storage: OutboxStorage = getOutboxStorage()): Promise<OutboxEntry[]> {
  return storage.read(outboxKey(userRef));
}

async function removeIds(userRef: string, ids: ReadonlySet<string>, storage: OutboxStorage): Promise<number> {
  const stored = await storage.mutate(outboxKey(userRef), (list) => list.filter((e) => !ids.has(e.id)));
  writeHint(userRef, stored.length);
  emit(userRef, { type: "change", pending: stored.length });
  return stored.length;
}

/** Sign-out (cdl §6.6): the user's queue goes away after its last flush. */
export async function clearOutbox(userRef: string, storage: OutboxStorage = getOutboxStorage()): Promise<void> {
  await storage.remove(outboxKey(userRef));
  writeHint(userRef, 0);
  emit(userRef, { type: "change", pending: 0 });
}

/**
 * Sign-out where the tab does not know whose stores it holds (a public page opened directly, FIX-2): every member's
 * queue goes, with every queue hint. Every key is per member and nobody is signed in after a sign-out, so nothing that
 * belongs to a signed-in member is lost.
 */
export async function clearAllOutboxes(storage: OutboxStorage = getOutboxStorage()): Promise<void> {
  await storage.removeAll();
  try {
    if (typeof localStorage === "undefined") return;
    const hints: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(hintKey(""))) hints.push(k);
    }
    for (const k of hints) localStorage.removeItem(k);
  } catch {
    // Storage blocked: no hints were written either.
  }
}

/** Sorted by `reviewedAt` (then enqueue order), with `stale: true` on entries older than 14 days. */
export function batchOrder(entries: readonly OutboxEntry[], now: number): AttemptIn[] {
  return [...entries]
    .sort((a, b) => Date.parse(a.attempt.reviewedAt) - Date.parse(b.attempt.reviewedAt) || a.at - b.at)
    .map((e) => (now - Date.parse(e.attempt.reviewedAt) > STALE_AFTER_MS ? { ...e.attempt, stale: true } : e.attempt));
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type OutboxEvent =
  | { type: "change"; pending: number }
  | { type: "result"; attempts: AttemptIn[]; result: AttemptsResult }
  | { type: "paywall"; error: unknown }
  | { type: "unauthorized"; error: unknown }
  | { type: "dropped"; attempt: AttemptIn; reason: "invalid" }
  | { type: "flushed"; outcome: FlushOutcome };

const listeners = new Map<string, Set<(e: OutboxEvent) => void>>();

export function subscribeOutbox(userRef: string, fn: (e: OutboxEvent) => void): () => void {
  const set = listeners.get(userRef) ?? new Set();
  listeners.set(userRef, set);
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(userRef);
  };
}

function emit(userRef: string, e: OutboxEvent): void {
  for (const fn of listeners.get(userRef) ?? []) {
    try {
      fn(e);
    } catch {
      // A listener never stops the outbox.
    }
  }
}

// ── Flush ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type AttemptsSender = (attempts: AttemptIn[], opts: { keepalive: boolean }) => Promise<AttemptsResult>;

/** What a failed send means for the queue. */
export type FailureKind = "retry" | "paywall" | "unauthorized" | "invalid";

/** Classifies a sender error (an ApiError from api(), or anything else). */
export function classifyFailure(err: unknown): { kind: FailureKind; retryAfterMs?: number } {
  const e = err as { status?: unknown; code?: unknown; retryAfterSec?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : 0;
  const code = typeof e?.code === "string" ? e.code : "";
  if (code === "subscription_required" || code === "payment_update_required" || status === 402) return { kind: "paywall" };
  if (code === "unauthorized" || status === 401) return { kind: "unauthorized" };
  if (status === 429) {
    const sec = typeof e?.retryAfterSec === "number" ? e.retryAfterSec : 0;
    return { kind: "retry", retryAfterMs: sec > 0 ? sec * 1000 : undefined };
  }
  if (status === 400 || status === 413 || status === 422) return { kind: "invalid" };
  // 0 (network, timeout, offline), 408, 5xx, 403 maintenance-like answers: keep and retry.
  return { kind: "retry" };
}

export type FlushOutcome = {
  status: "empty" | "busy" | "sent" | "retry" | "paywall" | "unauthorized";
  /** Attempts that got a terminal result in this flush. */
  sent: number;
  results: AttemptOut[];
  /** Entries still queued afterwards. */
  pending: number;
  retryAfterMs?: number;
};

export type LockRunner = <T>(name: string, fn: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;

/** Web Locks (`ifAvailable`), or an in-tab mutex where the browser lacks them. */
export const browserLocks: LockRunner = async <T>(name: string, fn: () => Promise<T>) => {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return inTabLock(name, fn);
  let out: { ran: true; value: T } | { ran: false } = { ran: false };
  await locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    out = { ran: true, value: await fn() };
  });
  return out;
};

const held = new Set<string>();
async function inTabLock<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (held.has(name)) return { ran: false };
  held.add(name);
  try {
    return { ran: true, value: await fn() };
  } finally {
    held.delete(name);
  }
}

export type FlushDeps = {
  send: AttemptsSender;
  storage?: OutboxStorage;
  locks?: LockRunner;
  now?: () => number;
};

/**
 * Sends everything queued for `userRef` (batches ≤ 50, oldest first) under the user's lock. A flush that does not get
 * the lock returns `busy` at once: the other tab is sending the same queue.
 */
export async function flushAttempts(userRef: string, deps: FlushDeps, opts: { keepalive?: boolean } = {}): Promise<FlushOutcome> {
  const storage = deps.storage ?? getOutboxStorage();
  const locks = deps.locks ?? browserLocks;
  const now = deps.now ?? Date.now;
  const lock = await locks(`rc-outbox:${userRef}`, () => flushLocked(userRef, storage, deps.send, now, opts.keepalive === true));
  const outcome: FlushOutcome = lock.ran ? lock.value : { status: "busy", sent: 0, results: [], pending: (await storage.read(outboxKey(userRef))).length };
  emit(userRef, { type: "flushed", outcome });
  return outcome;
}

async function flushLocked(userRef: string, storage: OutboxStorage, send: AttemptsSender, now: () => number, keepalive: boolean): Promise<FlushOutcome> {
  const results: AttemptOut[] = [];
  let sent = 0;
  // The queue may grow while we send (grades keep coming): loop until it is empty or a send fails.
  for (let round = 0; round < OUTBOX_CAP; round++) {
    const entries = await storage.read(outboxKey(userRef));
    if (!entries.length) return { status: sent ? "sent" : "empty", sent, results, pending: 0 };
    const batch = batchOrder(entries, now()).slice(0, OUTBOX_BATCH_MAX);
    const r = await sendBatch(userRef, batch, storage, send, keepalive);
    sent += r.sent;
    results.push(...r.results);
    if (r.stop) {
      const pending = (await storage.read(outboxKey(userRef))).length;
      return { status: r.stop.kind, sent, results, pending, retryAfterMs: r.stop.retryAfterMs };
    }
    // A server that answered without a result for any of them: try again later rather than loop.
    if (r.sent === 0 && !r.dropped) {
      const pending = (await storage.read(outboxKey(userRef))).length;
      return { status: "retry", sent, results, pending };
    }
  }
  const pending = (await storage.read(outboxKey(userRef))).length;
  return { status: pending ? "retry" : "sent", sent, results, pending };
}

type BatchStop = { kind: "retry" | "paywall" | "unauthorized"; retryAfterMs?: number };

async function sendBatch(
  userRef: string,
  batch: AttemptIn[],
  storage: OutboxStorage,
  send: AttemptsSender,
  keepalive: boolean,
): Promise<{ sent: number; results: AttemptOut[]; dropped?: number; stop?: BatchStop }> {
  let result: AttemptsResult;
  try {
    result = await send(batch, { keepalive });
  } catch (err) {
    const f = classifyFailure(err);
    if (f.kind === "paywall") {
      emit(userRef, { type: "paywall", error: err });
      return { sent: 0, results: [], stop: { kind: "paywall" } };
    }
    if (f.kind === "unauthorized") {
      emit(userRef, { type: "unauthorized", error: err });
      return { sent: 0, results: [], stop: { kind: "unauthorized" } };
    }
    if (f.kind === "retry") return { sent: 0, results: [], stop: { kind: "retry", retryAfterMs: f.retryAfterMs } };
    // invalid: isolate the bad entry by sending one at a time; a single the server still refuses is dropped.
    if (batch.length > 1) {
      let sent = 0;
      let dropped = 0;
      const results: AttemptOut[] = [];
      for (const one of batch) {
        const r = await sendBatch(userRef, [one], storage, send, keepalive);
        sent += r.sent;
        dropped += r.dropped ?? 0;
        results.push(...r.results);
        if (r.stop) return { sent, results, dropped, stop: r.stop };
      }
      return { sent, results, dropped };
    }
    const bad = batch[0]!;
    await removeIds(userRef, new Set([bad.clientAttemptId]), storage);
    emit(userRef, { type: "dropped", attempt: bad, reason: "invalid" });
    return { sent: 0, results: [], dropped: 1 };
  }
  const done = new Set(result.results.map((r) => r.clientAttemptId));
  await removeIds(userRef, done, storage);
  emit(userRef, { type: "result", attempts: batch, result });
  return { sent: done.size, results: result.results };
}

// ── Scheduler (one per user per tab) ──────────────────────────────────────────────────────────────────────────────
export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export type OutboxScheduler = {
  /** After an enqueue: flush now at ≥ 3 waiting, else 4 s after the last enqueue. */
  noteEnqueued(pending: number): void;
  /** Flush now (session end, hidden, online, mount). Single-flight: a second call joins the first. */
  flush(opts?: { keepalive?: boolean }): Promise<FlushOutcome>;
  /** Stops the timers (tests, user switch). */
  dispose(): void;
};

export function createOutboxScheduler(
  userRef: string,
  deps: FlushDeps & { timers?: Timers },
): OutboxScheduler {
  const timers: Timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };
  let debounce: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  let inflight: Promise<FlushOutcome> | null = null;
  let disposed = false;

  const clear = (t: unknown) => {
    if (t !== null) timers.clearTimeout(t);
  };

  const run = (opts: { keepalive?: boolean } = {}): Promise<FlushOutcome> => {
    // A disposed scheduler (its member signed out or switched) sends nothing.
    if (disposed) return Promise.resolve({ status: "busy", sent: 0, results: [], pending: 0 });
    if (inflight && !opts.keepalive) return inflight;
    clear(debounce);
    debounce = null;
    const p = flushAttempts(userRef, deps, opts).then((outcome) => {
      if (outcome.status === "retry") {
        const delay = outcome.retryAfterMs ?? RETRY_DELAYS_MS[failures];
        failures++;
        clear(retry);
        retry = null;
        if (delay !== undefined && !disposed) {
          retry = timers.setTimeout(() => {
            retry = null;
            void run();
          }, delay);
        }
      } else if (outcome.status === "sent" || outcome.status === "empty") {
        failures = 0;
      }
      return outcome;
    });
    if (!opts.keepalive) {
      inflight = p;
      void p.finally(() => {
        if (inflight === p) inflight = null;
      });
    }
    return p;
  };

  return {
    noteEnqueued(pending) {
      if (disposed) return;
      if (pending >= FLUSH_AT_COUNT) {
        void run();
        return;
      }
      clear(debounce);
      debounce = timers.setTimeout(() => {
        debounce = null;
        void run();
      }, FLUSH_DEBOUNCE_MS);
    },
    flush(opts) {
      // An explicit flush (online, visible, mount, session end) restarts the backoff.
      failures = 0;
      clear(retry);
      retry = null;
      return run(opts);
    },
    dispose() {
      disposed = true;
      clear(debounce);
      clear(retry);
      debounce = null;
      retry = null;
    },
  };
}
