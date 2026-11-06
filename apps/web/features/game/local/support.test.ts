// Bot-game support modules (phase-02 plan 5.3.2, 5.3.3, 8.14): hint levels and the per-position cache, the undo
// copy, the journal store and checkpoints, the two-tab lock, and the pending-complete queue.
import assert from "node:assert/strict";
import { test } from "node:test";
import { journalKey, type BotJournal } from "@repo/game-core/local/journal";
import { ApiError } from "@/lib/api/errors";
import { HintCache, nextHint, numberedSan, tookBackText } from "./hints";
import { createTabLock, newerClaim, type ChannelLike, type LockMessage } from "./lock";
import { flushPendingBotCompletes, isFinalCompleteError, markCompleteInFlight } from "./pendingCompletes";
import { listJournals, readJournal, removeJournal, sendCheckpoint, writeJournal, type KeyValueStore } from "./persist";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

class MemoryStore implements KeyValueStore {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

// ── hints ──

test("nextHint: level 1 names the piece, level 2 draws the arrow; one search per position; then repeats", async () => {
  let searches = 0;
  const source = { best: async () => (searches++, "g1f3") };
  const cache = new HintCache();
  const s = { fen: START, startFen: START, moves: "" };
  const one = await nextHint(s, null, source, cache);
  assert.equal(one.kind, "shown");
  assert.equal(one.kind === "shown" && one.level, 1);
  assert.equal(one.kind === "shown" && one.view.text, "Hint 1 of 2: look at your knight.");
  assert.equal(one.kind === "shown" && one.view.arrow, null);
  const key = { key: START.split(" ").slice(0, 4).join(" "), level: 1 as const };
  const two = await nextHint(s, key, source, cache);
  assert.equal(two.kind === "shown" && two.view.text, "Hint 2 of 2: play Nf3.");
  assert.deepEqual(two.kind === "shown" && two.view.arrow, { from: "g1", to: "f3", color: "#0369a1" });
  const again = await nextHint(s, { ...key, level: 2 }, source, cache);
  assert.equal(again.kind, "repeat");
  assert.equal(searches, 1);
  // A cancelled search and an empty answer.
  assert.equal((await nextHint({ ...s, fen: "8/8/8/8/8/8/8/K6k w - - 0 1" }, null, { best: async () => null }, cache)).kind, "cancelled");
  assert.equal((await nextHint({ ...s, fen: "8/8/8/8/8/8/8/K6k w - - 0 1" }, null, { best: async () => "" }, cache)).kind, "none");
});

test("the undo toast numbers both plies (plan 8.14)", () => {
  assert.equal(numberedSan(21, "Bxb5+"), "11.Bxb5+");
  assert.equal(numberedSan(22, "Nbd7"), "11…Nbd7");
  assert.equal(tookBackText(["Bxb5+", "Nbd7"], 21, 0), "Took back 11.Bxb5+ and 11…Nbd7.");
  // A game that starts from Black to move at move 11 (startPly 21): the first relative ply is 11…
  assert.equal(tookBackText(["Nbd7"], 1, 21), "Took back 11…Nbd7.");
  assert.equal(tookBackText([], 1, 0), "Took back your last move.");
});

// ── journal + checkpoints ──

const J: BotJournal = { v: 1, rev: 3, moves: ["e2e4", "e7e5"], clocksMs: [600000, 600000], startedAt: 1, assists: { hints: 1, undos: 0 }, updatedAt: 2 };

test("journal round trip, listing, removal; storage failures never throw", () => {
  const store = new MemoryStore();
  assert.ok(writeJournal("g1", J, store));
  assert.deepEqual(readJournal("g1", store), J);
  store.setItem(journalKey("bad"), "{not json");
  store.setItem("rc:other", "x");
  const listed = listJournals(store);
  assert.deepEqual(
    listed.map((l) => [l.ref, l.journal?.rev ?? null]),
    [
      ["g1", 3],
      ["bad", null],
    ],
  );
  removeJournal("g1", store);
  assert.equal(readJournal("g1", store), null);
  const throwing = {
    get length() {
      throw new Error("blocked");
    },
    key: () => null,
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  } as unknown as KeyValueStore;
  assert.equal(writeJournal("g1", J, throwing), false);
  assert.equal(readJournal("g1", throwing), null);
  assert.deepEqual(listJournals(throwing), []);
  removeJournal("g1", throwing);
  assert.equal(writeJournal("g1", J, null), false);
});

test("sendCheckpoint: beacon with a text/plain body, fetch when the beacon is refused or in fetch mode", async () => {
  const calls: string[] = [];
  let beaconOk = true;
  const transport = {
    beacon: (url: string, body: Blob) => {
      calls.push(`beacon ${url} ${body.type}`);
      return beaconOk;
    },
    fetch: async (url: string) => {
      calls.push(`fetch ${url}`);
      throw new Error("offline");
    },
  };
  const body = { rev: 4, moves: ["e2e4"], clocksMs: [600000], assists: { hints: 0, undos: 0 } };
  sendCheckpoint("g/1", body, "beacon", transport);
  beaconOk = false;
  sendCheckpoint("g1", body, "beacon", transport);
  sendCheckpoint("g1", body, "fetch", transport);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [
    "beacon /api/games/g%2F1/checkpoint text/plain;charset=utf-8",
    "beacon /api/games/g1/checkpoint text/plain;charset=utf-8",
    "fetch /api/games/g1/checkpoint",
    "fetch /api/games/g1/checkpoint",
  ]);
});

// ── two-tab lock ──

class Bus {
  members = new Set<ChannelLike>();
  channel(): ChannelLike {
    const ch: ChannelLike = {
      onmessage: null,
      postMessage: (m: LockMessage) => {
        for (const other of this.members) if (other !== ch) other.onmessage?.({ data: m });
      },
      close: () => this.members.delete(ch),
    };
    this.members.add(ch);
    return ch;
  }
}

test("tab lock: the newest tab wins; 'Use this tab' takes it back; ties break on the id", () => {
  const bus = new Bus();
  let t = 1000;
  const lost: string[] = [];
  const mk = (id: string) => createTabLock("g1", { onLost: () => lost.push(id) }, { channel: () => bus.channel(), now: () => t, id: () => id });
  const a = mk("a");
  a.claim();
  t = 2000;
  const b = mk("b");
  b.claim();
  assert.deepEqual(lost, ["a"]);
  assert.ok(!a.held() && b.held());
  a.claim(); // "Use this tab", same millisecond as nothing: still strictly newer
  assert.deepEqual(lost, ["a", "b"]);
  assert.ok(a.held() && !b.held());
  assert.ok(newerClaim({ at: 5, id: "b" }, { at: 5, id: "a" }));
  assert.ok(!newerClaim({ at: 4, id: "z" }, { at: 5, id: "a" }));
  a.close();
  b.close();
  assert.equal(bus.members.size, 0);
  // No BroadcastChannel: every tab owns its game.
  const solo = createTabLock("g1", { onLost: () => assert.fail("no channel, no loss") }, { channel: () => null, now: () => 1, id: () => "s" });
  solo.claim();
  assert.ok(solo.held());
});

// ── pending completes ──

const body = { rev: 9, moves: ["f2f3", "e7e5", "g2g4", "d8h4"], clocksMs: [], result: "b" as const, method: "checkmate" as const, assists: { hints: 0, undos: 0 }, endedAtClient: 5 };

test("flush: sent → removed, final refusal → removed, transient → kept, stale journals pruned, in-flight skipped", async () => {
  const store = new MemoryStore();
  const DAY = 86_400_000;
  const now = 100 * DAY;
  writeJournal("ok", { ...J, pendingComplete: body }, store);
  writeJournal("gone", { ...J, pendingComplete: body }, store);
  writeJournal("later", { ...J, pendingComplete: body }, store);
  writeJournal("busy", { ...J, pendingComplete: body }, store);
  writeJournal("live", { ...J, updatedAt: now - DAY }, store);
  writeJournal("stale", { ...J, updatedAt: now - 8 * DAY }, store);
  store.setItem(journalKey("junk"), "[]");
  const unmark = markCompleteInFlight("busy");
  const sent: string[] = [];
  const result = await flushPendingBotCompletes({
    store,
    now: () => now,
    complete: async (ref) => {
      sent.push(ref);
      if (ref === "gone") throw new ApiError({ status: 409, code: "conflict" });
      if (ref === "later") throw new ApiError({ status: 0, code: "network" });
      return { status: "COMPLETED", outcome: "BLACK", method: "checkmate", analysis: { status: "none" } };
    },
  });
  unmark();
  assert.deepEqual(sent.sort(), ["gone", "later", "ok"]);
  assert.deepEqual(result.sent, ["ok"]);
  assert.deepEqual(result.dropped, ["gone"]);
  assert.deepEqual(result.kept.sort(), ["busy", "later"]);
  assert.deepEqual(result.pruned.sort(), ["junk", "stale"]);
  assert.deepEqual([...store.map.keys()].sort(), ["rc:bot:busy", "rc:bot:later", "rc:bot:live"]);
});

test("final complete errors: 403/404/409/422 only", () => {
  for (const status of [403, 404, 409, 422]) assert.ok(isFinalCompleteError(new ApiError({ status, code: "conflict" })));
  for (const status of [0, 402, 429, 500, 503]) assert.ok(!isFinalCompleteError(new ApiError({ status, code: "internal" })));
  assert.ok(!isFinalCompleteError(new Error("x")));
});
