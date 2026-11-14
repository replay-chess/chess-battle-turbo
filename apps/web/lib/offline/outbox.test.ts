// The training outbox (phase-05 plan §5.4, §12.1 `outbox.test.ts`) on a real IndexedDB (fake-indexeddb): durable
// enqueue, flush in reviewedAt order in batches of ≤ 50, every terminal result leaves the queue, 402 / 401 keep it,
// network and 5xx retry 1 s → 4 s → 15 s, an invalid batch is split and only the bad entry dropped, two tabs never
// double-send (Web Locks `ifAvailable`), the cap of 500, the 14-day stale flag; plus crossTab and snapshots.
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { ATTEMPTS_BATCH_MAX, type AttemptIn, type AttemptOut, type AttemptsResult } from "@repo/contracts/http/train";
import { attemptsFixture, sessionPayloadFixture } from "@repo/contracts/http/fixtures/p05";
import { createStore } from "idb-keyval";
import {
  batchOrder,
  classifyFailure,
  clearOutbox,
  clearAllOutboxes,
  createOutboxScheduler,
  enqueueAttempt,
  outboxKey,
  flushAttempts,
  idbStorage,
  OUTBOX_BATCH_MAX,
  OUTBOX_CAP,
  pendingAttempts,
  setOutboxStorage,
  STALE_AFTER_MS,
  subscribeOutbox,
  type AttemptsSender,
  type LockRunner,
  type OutboxStorage,
  type Timers,
} from "./outbox";
import { parseSyncMessage, broadcastStale, listenCrossTab, type SyncChannelLike, type SyncMessage } from "./crossTab";
import { loadSessionSnapshot, saveSessionSnapshot, clearAllSnapshots, clearSessionSnapshots, SNAPSHOT_KEEP, type SnapshotStore, type SessionSnapshot } from "./snapshots";
import { disposeAttemptsScheduler, getAttemptsScheduler, guardedSender, installAttemptsSync, newPlanSteps, type OutboxSentry } from "./attempts-sync";
import { QueryClient } from "@tanstack/react-query";
import { resetOutboxUser, setOutboxUser } from "./active-user";

const USER = "cm0us3r000001slzpoutbox01";
const NOW = Date.parse("2026-11-12T19:00:00.000Z");
let dbN = 0;
let storage: OutboxStorage;

beforeEach(() => {
  storage = idbStorage(createStore(`rc-outbox-test-${++dbN}`, "items"));
  setOutboxStorage(storage);
});

function attempts(n: number, offsetMin = 0): AttemptIn[] {
  return attemptsFixture(n).map((a, i) => ({
    ...a,
    clientAttemptId: `00000000-0000-4000-8000-${String(i + offsetMin * 1000).padStart(12, "0")}`,
    reviewedAt: new Date(NOW + (i + offsetMin) * 60_000).toISOString(),
  }));
}

function okResult(batch: AttemptIn[], status: AttemptOut["status"] = "ok"): AttemptsResult {
  return { results: batch.map((a) => ({ clientAttemptId: a.clientAttemptId, status })), capRemaining: 7, planDone: 1, bankDue: 3 };
}

const noLock: LockRunner = async (_name, fn) => ({ ran: true, value: await fn() });

test("FIX-2: emptying the queue racing an enqueue keeps the new grade (one IndexedDB transaction per mutate)", async () => {
  // The reviewer's probe: the flush's removeIds empties the queue while the runner (or another tab) enqueues.
  const [a1, a2] = attempts(2);
  await enqueueAttempt(USER, a1!, { storage });
  for (let round = 0; round < 20; round++) {
    const empty = storage.mutate(outboxKey(USER), () => []);
    const add = enqueueAttempt(USER, { ...a2!, clientAttemptId: `00000000-0000-4000-8000-${String(900 + round).padStart(12, "0")}` }, { storage });
    await Promise.all([empty, add]);
    const left = (await pendingAttempts(USER, storage)).map((e) => e.id);
    assert.deepEqual(left, [`00000000-0000-4000-8000-${String(900 + round).padStart(12, "0")}`], `round ${round}: the enqueued grade is still queued`);
  }
});

test("the batch limit is the contract's", () => {
  assert.equal(OUTBOX_BATCH_MAX, ATTEMPTS_BATCH_MAX);
});

test("enqueue is durable and idempotent per clientAttemptId; flush sends in reviewedAt order and settles", async () => {
  const list = attempts(3);
  for (const a of [list[2]!, list[0]!, list[1]!, list[0]!]) await enqueueAttempt(USER, a, { storage, now: NOW });
  assert.equal((await pendingAttempts(USER, storage)).length, 3);
  const sent: AttemptIn[][] = [];
  const send: AttemptsSender = async (batch) => {
    sent.push(batch);
    return okResult(batch);
  };
  const events: string[] = [];
  const off = subscribeOutbox(USER, (e) => events.push(e.type));
  const out = await flushAttempts(USER, { send, storage, locks: noLock, now: () => NOW });
  off();
  assert.equal(out.status, "sent");
  assert.equal(out.sent, 3);
  assert.deepEqual(sent[0]!.map((a) => a.clientAttemptId), list.map((a) => a.clientAttemptId));
  assert.equal((await pendingAttempts(USER, storage)).length, 0);
  assert.ok(events.includes("result") && events.includes("flushed"));
});

test("duplicate, conflict and rejected results are terminal: the entries leave the queue", async () => {
  const list = attempts(3);
  for (const a of list) await enqueueAttempt(USER, a, { storage });
  const statuses: AttemptOut["status"][] = ["duplicate", "conflict", "rejected"];
  const send: AttemptsSender = async (batch) => ({ ...okResult(batch), results: batch.map((a, i) => ({ clientAttemptId: a.clientAttemptId, status: statuses[i]! })) });
  const out = await flushAttempts(USER, { send, storage, locks: noLock });
  assert.equal(out.sent, 3);
  assert.deepEqual(out.results.map((r) => r.status), statuses);
  assert.equal((await pendingAttempts(USER, storage)).length, 0);
});

test("partial results: an attempt the server did not answer stays queued and the flush retries later", async () => {
  const list = attempts(2);
  for (const a of list) await enqueueAttempt(USER, a, { storage });
  let calls = 0;
  const send: AttemptsSender = async (batch) => {
    calls++;
    return calls === 1 ? okResult(batch.slice(0, 1)) : { ...okResult([]), results: [] };
  };
  const out = await flushAttempts(USER, { send, storage, locks: noLock });
  assert.equal(out.status, "retry");
  assert.equal(out.sent, 1);
  assert.deepEqual((await pendingAttempts(USER, storage)).map((e) => e.id), [list[1]!.clientAttemptId]);
});

test("402 stops and keeps every entry (and tells the app); 401 keeps them too", async () => {
  for (const a of attempts(2)) await enqueueAttempt(USER, a, { storage });
  const seen: string[] = [];
  const off = subscribeOutbox(USER, (e) => seen.push(e.type));
  const pay = await flushAttempts(USER, { send: async () => Promise.reject({ status: 402, code: "subscription_required" }), storage, locks: noLock });
  const auth = await flushAttempts(USER, { send: async () => Promise.reject({ status: 401, code: "unauthorized" }), storage, locks: noLock });
  off();
  assert.equal(pay.status, "paywall");
  assert.equal(auth.status, "unauthorized");
  assert.equal(pay.pending, 2);
  assert.ok(seen.includes("paywall") && seen.includes("unauthorized"));
});

test("network, 5xx and 429 keep the entries and ask for a retry (429 with its Retry-After)", async () => {
  for (const a of attempts(1)) await enqueueAttempt(USER, a, { storage });
  assert.equal((await flushAttempts(USER, { send: async () => Promise.reject({ status: 0, code: "offline" }), storage, locks: noLock })).status, "retry");
  assert.equal((await flushAttempts(USER, { send: async () => Promise.reject({ status: 503, code: "maintenance" }), storage, locks: noLock })).status, "retry");
  const limited = await flushAttempts(USER, { send: async () => Promise.reject({ status: 429, code: "rate_limited", retryAfterSec: 12 }), storage, locks: noLock });
  assert.equal(limited.retryAfterMs, 12_000);
  assert.equal((await pendingAttempts(USER, storage)).length, 1);
  assert.deepEqual(classifyFailure(new Error("boom")), { kind: "retry" });
});

test("FIX-2 (§10.2): train.outbox.age_s on every applied flush; failed flushes are breadcrumbs, the 3rd in a row is captured once", async () => {
  const metrics: [string, number, string][] = [];
  const crumbs: string[] = [];
  const captures: [string, Record<string, unknown>][] = [];
  const sentry: OutboxSentry = {
    metric: (name, value, unit) => void metrics.push([name, value, unit]),
    breadcrumb: (message) => void crumbs.push(message),
    capture: (message, extra) => void captures.push([message, extra]),
  };
  // Node has a real BroadcastChannel, which would keep the test process alive: the cross-tab message is not under test.
  const bc = Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel");
  Object.defineProperty(globalThis, "BroadcastChannel", { value: undefined, configurable: true, writable: true });
  const uninstall = installAttemptsSync(USER, new QueryClient(), { now: () => NOW + 90_000, isOnline: () => true, sentry });
  try {
    for (const a of attempts(2)) await enqueueAttempt(USER, a, { storage });
    const down = async () => Promise.reject({ status: 503, code: "maintenance" });
    for (let i = 0; i < 5; i++) assert.equal((await flushAttempts(USER, { send: down, storage, locks: noLock })).status, "retry");
    assert.equal(crumbs.filter((c) => c === "flush retry").length, 5, "every failure is a breadcrumb");
    assert.deepEqual(captures, [["train.outbox.flush_failed", { failures: 3, pending: 2 }]], "captured once, at the 3rd");
    assert.equal((await flushAttempts(USER, { send: async (b) => okResult(b), storage, locks: noLock })).status, "sent");
    // The oldest attempt was graded at NOW; the flush ran at NOW + 90 s.
    assert.deepEqual(metrics, [["train.outbox.age_s", 90, "second"]]);
    // The streak restarts after a success: two more failures capture nothing.
    await enqueueAttempt(USER, attempts(1, 7)[0]!, { storage });
    for (let i = 0; i < 2; i++) await flushAttempts(USER, { send: down, storage, locks: noLock });
    assert.equal(captures.length, 1);
  } finally {
    uninstall();
    if (bc) Object.defineProperty(globalThis, "BroadcastChannel", bc);
  }
});

test("an invalid batch is split: the good attempts land, the bad one is dropped with an event", async () => {
  const list = attempts(3);
  for (const a of list) await enqueueAttempt(USER, a, { storage });
  const bad = list[1]!.clientAttemptId;
  const send: AttemptsSender = async (batch) => {
    if (batch.some((a) => a.clientAttemptId === bad)) throw { status: 400, code: "validation_failed" };
    return okResult(batch);
  };
  const dropped: string[] = [];
  const off = subscribeOutbox(USER, (e) => {
    if (e.type === "dropped") dropped.push(e.attempt.clientAttemptId);
  });
  const out = await flushAttempts(USER, { send, storage, locks: noLock });
  off();
  assert.equal(out.sent, 2);
  assert.deepEqual(dropped, [bad]);
  assert.equal((await pendingAttempts(USER, storage)).length, 0);
});

test("more than 50 queued go in batches of ≤ 50", async () => {
  for (const a of attempts(120)) await enqueueAttempt(USER, a, { storage });
  const sizes: number[] = [];
  const out = await flushAttempts(USER, { send: async (b) => (sizes.push(b.length), okResult(b)), storage, locks: noLock });
  assert.deepEqual(sizes, [50, 50, 20]);
  assert.equal(out.sent, 120);
});

test("two tabs: the one without the lock skips, so nothing is sent twice", async () => {
  for (const a of attempts(3)) await enqueueAttempt(USER, a, { storage });
  // A Web Locks stub: `ifAvailable` → the second request gets no lock while the first holds it.
  const held = new Set<string>();
  const locks: LockRunner = async (name, fn) => {
    if (held.has(name)) return { ran: false };
    held.add(name);
    try {
      return { ran: true, value: await fn() };
    } finally {
      held.delete(name);
    }
  };
  let sends = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const send: AttemptsSender = async (batch) => {
    sends++;
    await gate;
    return okResult(batch);
  };
  const a = flushAttempts(USER, { send, storage, locks });
  const b = flushAttempts(USER, { send, storage, locks });
  assert.equal((await b).status, "busy");
  release();
  assert.equal((await a).sent, 3);
  assert.equal(sends, 1);
});

test("the queue keeps the newest 500 per user", async () => {
  const many = attempts(OUTBOX_CAP + 5);
  for (const a of many) await enqueueAttempt(USER, a, { storage });
  const left = await pendingAttempts(USER, storage);
  assert.equal(left.length, OUTBOX_CAP);
  assert.equal(left[0]!.id, many[5]!.clientAttemptId);
});

test("entries older than 14 days are sent with stale: true", () => {
  const [fresh, old] = attempts(2);
  const entries = [
    { id: "a", at: 0, attempt: { ...fresh!, reviewedAt: new Date(NOW - 1000).toISOString() } },
    { id: "b", at: 0, attempt: { ...old!, reviewedAt: new Date(NOW - STALE_AFTER_MS - 1000).toISOString() } },
  ];
  const out = batchOrder(entries, NOW);
  assert.equal(out[0]!.stale, true);
  assert.equal(out[1]!.stale, undefined);
});

test("FIX-2: clearAllOutboxes and clearAllSnapshots remove every member's keys and queue hints (sign-out, member unknown)", async () => {
  await enqueueAttempt(USER, attempts(1)[0]!, { storage });
  await enqueueAttempt("cm0us3r000002slzpoutbox02", attempts(1, 5)[0]!, { storage });
  const snaps = new Map<string, SessionSnapshot>();
  const snapStore: SnapshotStore = {
    get: async (k) => snaps.get(k),
    set: async (k, v) => void snaps.set(k, v),
    del: async (k) => void snaps.delete(k),
    keys: async () => [...snaps.keys()],
  };
  await saveSessionSnapshot(USER, sessionPayloadFixture("bank"), { store: snapStore });
  await saveSessionSnapshot("cm0us3r000002slzpoutbox02", sessionPayloadFixture("puzzles"), { store: snapStore });
  await clearAllOutboxes(storage);
  await clearAllSnapshots(snapStore);
  assert.deepEqual(await pendingAttempts(USER, storage), []);
  assert.deepEqual(await pendingAttempts("cm0us3r000002slzpoutbox02", storage), []);
  assert.equal(snaps.size, 0);
});

test("clearOutbox removes the user's queue (sign-out)", async () => {
  for (const a of attempts(2)) await enqueueAttempt(USER, a, { storage });
  await clearOutbox(USER, storage);
  assert.equal((await pendingAttempts(USER, storage)).length, 0);
});

// ── scheduler ──────────────────────────────────────────────────────────────────────────────────────────────────
function fakeTimers() {
  let t = 0;
  let seq = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      q.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (id) => void q.delete(id as number),
  };
  const advance = async (ms: number) => {
    t += ms;
    for (const [id, x] of [...q].sort((a, b) => a[1].at - b[1].at)) {
      if (x.at <= t) {
        q.delete(id);
        x.fn();
        await new Promise((r) => setImmediate(r));
      }
    }
  };
  return { timers, advance, pending: () => [...q.values()].map((x) => x.at - t) };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("scheduler: ≥ 3 queued flush at once; fewer wait 4 s after the last enqueue", async () => {
  const ft = fakeTimers();
  let sends = 0;
  const s = createOutboxScheduler(USER, { send: async (b) => (sends++, okResult(b)), storage, locks: noLock, timers: ft.timers });
  await enqueueAttempt(USER, attempts(1)[0]!, { storage });
  s.noteEnqueued(1);
  assert.deepEqual(ft.pending(), [4000]);
  await ft.advance(3999);
  assert.equal(sends, 0);
  await ft.advance(1);
  await settle();
  assert.equal(sends, 1);
  for (const a of attempts(3, 5)) await enqueueAttempt(USER, a, { storage });
  s.noteEnqueued(3);
  await settle();
  assert.equal(sends, 2);
  s.dispose();
});

test("scheduler: failures retry after 1 s, 4 s, 15 s, then wait for the next explicit flush", async () => {
  const ft = fakeTimers();
  let calls = 0;
  const s = createOutboxScheduler(USER, { send: async () => (calls++, Promise.reject({ status: 0, code: "network" })), storage, locks: noLock, timers: ft.timers });
  await enqueueAttempt(USER, attempts(1)[0]!, { storage });
  await s.flush();
  assert.deepEqual(ft.pending(), [1000]);
  await ft.advance(1000);
  await settle();
  assert.deepEqual(ft.pending(), [4000]);
  await ft.advance(4000);
  await settle();
  assert.deepEqual(ft.pending(), [15000]);
  await ft.advance(15000);
  await settle();
  assert.deepEqual(ft.pending(), []);
  assert.equal(calls, 4);
  await s.flush();
  assert.deepEqual(ft.pending(), [1000], "an explicit flush restarts the backoff");
  s.dispose();
});

// ── plan bits (attempts-sync) ──────────────────────────────────────────────────────────────────────────────────
test("newPlanSteps lists only the bits a batch newly set", () => {
  assert.deepEqual(newPlanSteps(0, 1), [0]);
  assert.deepEqual(newPlanSteps(1, 3), [1]);
  assert.deepEqual(newPlanSteps(3, 3), []);
});

// ── crossTab ───────────────────────────────────────────────────────────────────────────────────────────────────
test("crossTab: another tab's stale message marks the keys stale; own and malformed messages are ignored", async () => {
  assert.deepEqual(parseSyncMessage({ t: "stale", keys: [["train", "today"]], from: "b" }, "a"), [["train", "today"]]);
  assert.equal(parseSyncMessage({ t: "stale", keys: [["train"]], from: "a" }, "a"), null);
  assert.equal(parseSyncMessage({ t: "nope" }, "a"), null);
  assert.equal(parseSyncMessage({ t: "stale", keys: ["x"], from: "b" }, "a"), null);

  const peers: SyncChannelLike[] = [];
  const channel = (): SyncChannelLike => {
    const ch: SyncChannelLike = {
      onmessage: null,
      postMessage: (m: SyncMessage) => {
        for (const p of peers) if (p !== ch) p.onmessage?.({ data: m });
      },
      close: () => undefined,
    };
    peers.push(ch);
    return ch;
  };
  const invalidated: unknown[] = [];
  const qc = { invalidateQueries: async (o: { queryKey: unknown; refetchType: string }) => void invalidated.push([o.queryKey, o.refetchType]) };
  const stop = listenCrossTab(qc as never, { channel, id: "tab-b" });
  broadcastStale([["train", "today"], ["home"]], { channel, id: "tab-a" });
  assert.deepEqual(invalidated, [
    [["train", "today"], "none"],
    [["home"], "none"],
  ]);
  stop();
});

// ── snapshots ──────────────────────────────────────────────────────────────────────────────────────────────────
function memSnapshots(): SnapshotStore {
  const m = new Map<string, SessionSnapshot>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), del: async (k) => void m.delete(k), keys: async () => [...m.keys()] };
}

test("snapshots: saved per user and session, newest 3 kept, cleared at sign-out", async () => {
  const store = memSnapshots();
  const p = sessionPayloadFixture("bank");
  for (let i = 0; i < SNAPSHOT_KEEP + 2; i++) await saveSessionSnapshot(USER, { ...p, ref: `cm5t9s3ss000${i}slzpbankdrl1` }, { store, now: i });
  const keys = (await store.keys()).sort();
  assert.equal(keys.length, SNAPSHOT_KEEP);
  assert.ok(!keys.some((k) => k.includes("cm5t9s3ss0000")), "the oldest went");
  assert.equal((await loadSessionSnapshot(USER, `cm5t9s3ss0004slzpbankdrl1`, store))?.items.length, p.items.length);
  assert.equal(await loadSessionSnapshot("someone-else", `cm5t9s3ss0004slzpbankdrl1`, store), null);
  await clearSessionSnapshots(USER, store);
  assert.equal((await store.keys()).length, 0);
});

// FIX-1: after a re-auth as another member in the same document, the first member's queue is never sent with the new
// session (the server would answer not_found for their sessions and the outbox would drop the attempts for good).
test("another member's queue waits untouched while someone else is signed in", async () => {
  const OTHER = "cm0us3r000002slzpoutbox02";
  for (const a of attempts(2)) await enqueueAttempt(USER, a, { storage, now: NOW });
  let sent = 0;
  const send: AttemptsSender = async (batch) => {
    sent += batch.length;
    return okResult(batch);
  };
  try {
    setOutboxUser(OTHER);
    const blocked = await flushAttempts(USER, { send: guardedSender(USER, send), storage, now: () => NOW });
    assert.equal(blocked.status, "retry");
    assert.equal(sent, 0);
    assert.equal((await pendingAttempts(USER, storage)).length, 2, "the queue is kept for its member's next sign-in");
    setOutboxUser(USER);
    const flushed = await flushAttempts(USER, { send: guardedSender(USER, send), storage, now: () => NOW });
    assert.equal(flushed.status, "sent");
    assert.equal(sent, 2);
  } finally {
    resetOutboxUser();
  }
});

test("a disposed scheduler sends nothing, and the next one is a fresh scheduler", async () => {
  for (const a of attempts(1)) await enqueueAttempt(USER, a, { storage, now: NOW });
  let sent = 0;
  const send: AttemptsSender = async (batch) => {
    sent += batch.length;
    return okResult(batch);
  };
  const first = getAttemptsScheduler(USER, send);
  disposeAttemptsScheduler(USER);
  assert.equal((await first.flush()).status, "busy");
  assert.equal(sent, 0);
  const second = getAttemptsScheduler(USER, send);
  assert.notEqual(second, first);
  disposeAttemptsScheduler(USER);
});
