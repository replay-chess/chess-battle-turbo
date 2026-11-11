// The outbox persistence adapter (src/persist/outbox.ts) against a fake SQL client (no database): checkpoint cadence
// (B4: 10 plies or the max age, at once on a freeze, one write in flight), the finish carries every ply and a PGN
// with %clk, a transient error is retried once after a pool reset, the backoff and the outbox stats, and the drain
// flush. Plus the shutdown freeze.
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter, createOutboxPersistence } from "../src/persist/outbox";
import { createMemoryMetrics, SILENT_LOGGER } from "../src/ports";
import { closeAllClients, cmd, move, startGame, startServer, testTiming, until, user, waitFor, type TestServer } from "./helpers";

type Sql = { strings: readonly string[]; values: unknown[] };

function fakeDb(opts: { failFirst?: unknown } = {}) {
  const calls: { kind: string; values: unknown[] }[] = [];
  let failNext = opts.failFirst;
  let disconnects = 0;
  const db = {
    async $queryRaw(sql: Sql) {
      const text = sql.strings.join("?");
      if (failNext && text.includes("UPDATE games SET moves")) {
        const e = failNext;
        failNext = undefined;
        throw e;
      }
      if (text.includes("UPDATE games SET moves")) {
        calls.push({ kind: "checkpoint", values: sql.values });
        return [{ plyCount: 1 }];
      }
      if (text.includes("WITH g AS") && text.includes("COMPLETED")) {
        calls.push({ kind: "finish", values: sql.values });
        return [{ finished: 1, players: 2, standings: 0 }];
      }
      if (text.includes("SELECT 1")) {
        calls.push({ kind: "prewarm", values: [] });
        return [{ "?column?": 1 }];
      }
      calls.push({ kind: "other", values: sql.values });
      return [];
    },
    async $executeRaw() {
      return 0;
    },
    async $disconnect() {
      disconnects++;
    },
  };
  return { db, calls, disconnects: () => disconnects };
}

describe("outbox persistence (fake SQL)", () => {
  let server: TestServer;
  let fake: ReturnType<typeof fakeDb>;
  const metrics = createMemoryMetrics();

  before(async () => {
    const transient = Object.assign(new Error("Server has closed the connection."), { code: "P1017" });
    fake = fakeDb({ failFirst: transient });
    const timing = testTiming({}, { checkpointPlies: 4, checkpointMaxAgeMs: 200 });
    const persistence = createOutboxPersistence({
      db: fake.db as unknown as Parameters<typeof createOutboxPersistence>[0]["db"],
      journal: null,
      timing,
      now: Date.now,
      log: SILENT_LOGGER,
      metrics,
      liveRefs: () => [],
    });
    server = await startServer({ timing });
    // Swap the store's write side for the direct adapter, keep the memory `load`.
    const memory = server.persistence;
    Object.assign(memory, {
      journal: persistence.journal,
      checkpoint: persistence.checkpoint,
      finish: persistence.finish,
      prewarm: persistence.prewarm,
      flushAll: persistence.flushAll,
      stats: persistence.stats,
    });
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("checkpoints every 4 plies (test cadence), the finish carries all plies and a PGN, a transient error retries once", async () => {
    const { game, W, B } = await startGame(server, user("w"), user("b"));
    const line = ["f2f3", "e7e5", "g2g4", "d8h4"]; // fool's mate: 4 plies
    for (let i = 0; i < line.length; i++) {
      await new Promise((r) => setTimeout(r, 30));
      assert.equal((await move(i % 2 === 0 ? W : B, game.ref, i, line[i]!)).ok, true);
    }
    await until(() => fake.calls.some((c) => c.kind === "finish"), 3_000, "finish");
    const finish = fake.calls.find((c) => c.kind === "finish")!;
    assert.ok(finish.values.includes("f2f3 e7e5 g2g4 d8h4"), "every ply, the mate included");
    const pgn = finish.values.find((v) => typeof v === "string" && v.startsWith("[Event")) as string;
    assert.match(pgn, /%clk/);
    assert.match(pgn, /0-1/);
    assert.ok(fake.calls.some((c) => c.kind === "prewarm"), "prewarm when the game left waiting");
    assert.equal(fake.disconnects(), 1, "one pool reset for the transient error");
    assert.ok((metrics.counts.get("ws.persist.reconnect{op=checkpoint}") ?? 0) + (metrics.counts.get("ws.persist.reconnect{op=finish}") ?? 0) >= 1);
    assert.equal(metrics.counts.get("ws.persist.fail{op=checkpoint}"), undefined);
  });

  test("the max age flushes a single unflushed ply", async () => {
    const before = fake.calls.filter((c) => c.kind === "checkpoint").length;
    const { game, W } = await startGame(server, user("w"), user("b"));
    await move(W, game.ref, 0, "d2d4");
    await until(() => fake.calls.filter((c) => c.kind === "checkpoint").length > before, 2_000, "age flush");
  });
});

describe("shutdown", () => {
  test("SIGTERM drain freezes every running clock and refuses new sessions", async () => {
    const server = await startServer({ timing: testTiming() });
    const { game, W, B, session } = await startGame(server, user("w"), user("b"));
    await move(W, game.ref, 0, "e2e4");
    await move(B, game.ref, 1, "e7e5");
    // The notice and the frozen clocks are emitted in one tick, right before io.close(): the second one used to be
    // dropped with the connection's write buffer (flushWrites, D11). Both must arrive.
    const notice = waitFor(W, "server:restarting", 2_000);
    const noticeB = waitFor(B, "server:restarting", 2_000);
    const frozenB = waitFor(B, "clock:sync", 2_000, (p) => p.frozen !== undefined);
    const frozen = waitFor(W, "clock:sync", 2_000, (p) => p.frozen !== undefined);
    const s = session();
    const closing = server.handle.shutdown();
    const ev = await frozen;
    assert.equal(ev.frozen.reason, "restart");
    assert.ok((await notice).restartAt > 0, "White heard the restart");
    assert.ok((await noticeB).restartAt > 0, "Black heard the restart");
    assert.equal((await frozenB).frozen.reason, "restart");
    assert.equal(s.state.frozen !== null || s.isDestroyed, true);
    assert.ok(server.persistence.checkpoints.some((c) => c.ref === game.ref && c.reason === "freeze"));
    await closing;
    assert.deepEqual(await server.handle.registry.open("cabcdefghijklmnopqrstu"), { ok: false, code: "draining" });
    void cmd;
  });
});

// regression: FIX-A (WP-I §4.9) — a burst of first-join loads waits for a slot instead of timing out in the pool.
test("createLimiter runs at most `max` tasks at once, in arrival order", async () => {
  const limit = createLimiter(3);
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        order.push(i);
        active--;
      }),
    ),
  );
  assert.equal(peak, 3);
  assert.deepEqual(order.slice(0, 3).sort(), [0, 1, 2]);
});

// review of "one restore statement": it ran on the raw client, with no budget and no retry, so a Neon cold start at
// boot dropped the boot restore of every game without a journal file (their rows were never adopted) and could hold
// the join gate for as long as the connect took.
test("the restore's candidates statement has the load budget and one retry on a fresh connection", async () => {
  const metrics = createMemoryMetrics();
  let calls = 0;
  let disconnects = 0;
  const row = { id: 1n, ref: "crestorecand000000000000001", status: "IN_PROGRESS", moveClocksMs: [] };
  const flaky = {
    async $queryRaw() {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Server has closed the connection."), { code: "P1017" });
      return [row];
    },
    async $executeRaw() {
      return 0;
    },
    async $disconnect() {
      disconnects++;
    },
  };
  const base = { journal: null, timing: testTiming(), now: Date.now, log: SILENT_LOGGER, metrics, liveRefs: () => [] };
  type Db = Parameters<typeof createOutboxPersistence>[0]["db"];
  const p = createOutboxPersistence({ ...base, db: flaky as unknown as Db });
  const rows = await p.restoreCandidates([row.ref], 60_000);
  assert.equal(calls, 2, "retried once after the transient error");
  assert.equal(disconnects, 1, "on a fresh connection");
  assert.deepEqual(
    rows.map((r) => r.ref),
    [row.ref],
  );
  assert.equal(metrics.counts.get("ws.persist.reconnect{op=restore}"), 1);

  const hung = { ...flaky, $queryRaw: () => new Promise<never>(() => {}) };
  const q = createOutboxPersistence({ ...base, db: hung as unknown as Db, statementBudgetMs: 50 });
  const started = Date.now();
  await assert.rejects(q.restoreCandidates([], 60_000), /restore exceeded its 50 ms budget/);
  assert.ok(Date.now() - started < 2_000, "the budget, not the connect, bounds the restore");
  p.stop();
  q.stop();
});
