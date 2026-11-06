// Deploys and crashes (phase-02 plan 12.4 `restart`, 7.6, T11/T19/T20): the SIGTERM drain freezes every clock,
// fsyncs the journal and flushes the game; a new process restores it from the journal + DB row by replay (threefold
// history intact), frozen until both players attach, with the same ply, colours and clocks. A journal longer than
// the DB (a crash between checkpoints) pushes the missing plies with one checkpoint; a corrupt journal aborts the game
// (`ws.restore{result:"corrupt"}`); a newer journal format is skipped for the DB row; a game the journal ended but
// the DB did not is finished at boot.
import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeAllClients, cmd, connect, delay, waitFor, testTiming } from "./helpers";
import {
  DB_SKIP,
  disconnectAdmin,
  gameRow,
  makeGame,
  makeUser,
  newJournalDir,
  playLine,
  startDbGame,
  startDbServer,
  type DbServer,
} from "./db";

const servers: DbServer[] = [];
async function boot(journalDir: string, opts: Parameters<typeof startDbServer>[0] = {}): Promise<DbServer> {
  const s = await startDbServer({ journalDir, ...opts });
  servers.push(s);
  return s;
}

/** A crash: the journal is on disk (fsynced), nothing else is written, sockets just drop. */
async function crash(s: DbServer): Promise<void> {
  await s.booted.journal?.sync();
  s.booted.persistence.stop();
  s.booted.handle.registry.destroyAll();
  await new Promise<void>((resolve) => s.booted.handle.io.close(() => resolve()));
  await s.sql.db.$disconnect();
  servers.splice(servers.indexOf(s), 1);
}

const BEFORE = ["e2e4", "e7e5", "g1f3", "b8c6", "f3g1", "c6b8", "g1f3", "b8c6"]; // e4-e5 position twice
const AFTER = ["f3g1", "c6b8"]; // …and a third time → threefold

describe("restart (Postgres + journal)", { skip: DB_SKIP }, () => {
  afterEach(() => closeAllClients());
  after(async () => {
    for (const s of servers.splice(0)) await s.close();
    await disconnectAdmin();
  });

  test("drain → restore: same ply, colours and clocks, frozen until both attach, threefold history intact", async () => {
    const dir = newJournalDir();
    const a = await boot(dir);
    const { w, b, game, W, B, session } = await startDbGame(a);
    await playLine(W, B, game.ref, BEFORE);
    await delay(150); // both clocks have run a little
    const frozen = waitFor(W, "clock:sync", 3_000, (p) => p.frozen !== undefined);
    await a.booted.stop(); // the SIGTERM path (clients still connected, so they hear the freeze)
    await a.sql.db.$disconnect();
    servers.splice(servers.indexOf(a), 1);
    const f = await frozen;
    const clocksAtDrain = { w: f.clocks.w as number, b: f.clocks.b as number };
    void session;
    const row = await gameRow(game.id);
    assert.equal(row.plyCount, 8, "the drain flushed every ply");
    assert.equal(row.clockRunning, null, "stored frozen");
    assert.equal(row.whiteTimeMs, Math.round(clocksAtDrain.w));

    await delay(400); // downtime must not count against anyone
    const c = await boot(dir);
    const restoredReport = c.booted.handle.registry.get(game.ref);
    assert.ok(restoredReport, "restored at boot");
    assert.ok(restoredReport.state.frozen, "frozen until both attach");
    assert.equal(restoredReport.state.moves.length, 8);
    assert.equal(c.metrics.counts.get("ws.restore{result=journal}"), 1);

    const W2 = await connect(c.url, w);
    const B2 = await connect(c.url, b);
    const jw = await cmd(W2.socket, "game:join", { ref: game.ref });
    assert.equal(jw.color, "w", "same colours");
    const resumed = waitFor(W2.socket, "clock:sync", 3_000, (p) => p.frozen === undefined);
    const jb = await cmd(B2.socket, "game:join", { ref: game.ref });
    assert.equal(jb.color, "b");
    const r = await resumed;
    assert.ok(Math.abs(r.clocks.w - clocksAtDrain.w) < 50, `white clock kept: ${r.clocks.w} vs ${clocksAtDrain.w}`);
    assert.ok(Math.abs(r.clocks.b - clocksAtDrain.b) < 50, `black clock kept: ${r.clocks.b} vs ${clocksAtDrain.b}`);
    assert.equal(r.clocks.run, "w");

    const ended = waitFor(W2.socket, "game:ended", 5_000);
    await playLine(W2.socket, B2.socket, game.ref, AFTER, 8);
    const e = await ended;
    assert.equal(e.method, "threefold", "the replay kept the repetition history");
    let done = await gameRow(game.id);
    for (let i = 0; i < 40 && done.status !== "COMPLETED"; i++) {
      await delay(100);
      done = await gameRow(game.id);
    }
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.endMethod, "THREEFOLD");
    assert.equal(done.plyCount, 10);
  });

  test("a crash between checkpoints: the journal is longer than the DB, the restore pushes the plies", async () => {
    const dir = newJournalDir();
    const slow = testTiming({}, { checkpointPlies: 50, checkpointMaxAgeMs: 60_000 });
    const a = await boot(dir, { timing: slow });
    const { game, W, B } = await startDbGame(a);
    await playLine(W, B, game.ref, ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6"]);
    assert.equal((await gameRow(game.id)).plyCount, 0, "nothing checkpointed yet");
    await crash(a);
    const c = await boot(dir);
    assert.ok(c.booted.handle.registry.get(game.ref)?.state.frozen);
    assert.equal((await gameRow(game.id)).plyCount, 6, "the missing plies went in with one checkpoint");
    assert.equal(c.metrics.counts.get("ws.restore{result=journal}"), 1);
  });

  test("corrupt journal → the game is aborted (stale) and counted; a newer format is skipped for the DB row", async () => {
    const dir = newJournalDir();
    const [w, b] = [await makeUser("w"), await makeUser("b")];
    const bad = await makeGame(w, b);
    const newer = await makeGame(w, b);
    const open = (ref: string, v: number) =>
      JSON.stringify({ t: "open", v, at: Date.now(), ref, startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", tc: { i: 300000, inc: 0 }, colors: { w: w.ref, b: b.ref }, studyS: 0 });
    const ply = (n: number, uci: string) => JSON.stringify({ t: "ply", n, uci, san: "?", clk: 300000, spent: 0, at: Date.now() });
    writeFileSync(join(dir, `${bad.ref}.ndjson`), [open(bad.ref, 1), JSON.stringify({ t: "phase", at: Date.now(), phase: "playing" }), ply(1, "e2e4"), ply(2, "e2e4")].join("\n") + "\n");
    writeFileSync(join(dir, `${newer.ref}.ndjson`), [open(newer.ref, 99), ply(1, "e2e4")].join("\n") + "\n");
    const c = await boot(dir);
    const row = await gameRow(bad.id);
    assert.equal(row.status, "ABORTED");
    assert.equal(row.meta.abortedBy, "stale");
    assert.equal(c.metrics.counts.get("ws.restore{result=corrupt}"), 1);
    assert.equal(c.metrics.counts.get("ws.restore{result=journal_newer}"), 1);
    assert.equal((await gameRow(newer.id)).status, "IN_PROGRESS", "the newer journal is ignored, not fatal");
  });

  test("a game the journal ended but the DB did not is finished at boot", async () => {
    const dir = newJournalDir();
    const [w, b] = [await makeUser("w"), await makeUser("b")];
    const g = await makeGame(w, b);
    const at = Date.now();
    const lines = [
      { t: "open", v: 1, at, ref: g.ref, startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", tc: { i: 300000, inc: 0 }, colors: { w: w.ref, b: b.ref }, studyS: 0 },
      { t: "phase", at, phase: "playing" },
      { t: "ply", n: 1, uci: "f2f3", san: "f3", clk: 300000, spent: 0, at },
      { t: "ply", n: 2, uci: "e7e5", san: "e5", clk: 300000, spent: 0, at },
      { t: "ply", n: 3, uci: "g2g4", san: "g4", clk: 299000, spent: 1000, at },
      { t: "ply", n: 4, uci: "d8h4", san: "Qh4#", clk: 299000, spent: 1000, at },
      { t: "end", at, method: "checkmate", winner: "b", ply: 4 },
    ];
    writeFileSync(join(dir, `${g.ref}.ndjson`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const c = await boot(dir);
    const row = await gameRow(g.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.endMethod, "CHECKMATE");
    assert.equal(row.outcome, "BLACK");
    assert.equal(row.moves, "f2f3 e7e5 g2g4 d8h4");
    assert.equal(c.metrics.counts.get("ws.restore{result=finished}"), 1);
  });
});
