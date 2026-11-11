// A restart never counts against a player's disconnect grace or clock (phase-02 plan 7.6 restore steps 4–5, 8.6,
// T11/T19/T20). Both players are offline for the whole downtime and longer than the normal grace; the restored game
// is frozen and nobody is abandoned for having been away while the server was down:
//   - both back before the resume wait → it resumes when the second attaches, with the clocks of the drain;
//   - one back when the resume wait runs out → the absent side gets a fresh grace from the resume (not from the
//     drain or the boot), and coming back within it continues the game;
//   - nobody back by then → no grace starts while both are away; the first one back starts the other's grace.
// Regression context: restart-resume (e2e, CI run 43037495714) showed one player abandoned after a restart. The
// server rules held; a test-harness connection attempt hung for the client's 10 s connect timeout (fixed in
// apps/web/e2e/fixtures/socket-server.ts). These tests pin the server side with downtimes and gaps longer than grace.
//
// Also here: the drain itself (D7, D11: a bare SIGTERM announces the restart, and nobody is told the other side left)
// and the cost of the boot restore (one statement whatever the number of journal files; journals of games the DB
// had already ended are pruned by their age, not kept alive by every boot).
import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { Prisma } from "@repo/db";
import { restoreAtBoot } from "../src/persist/restore";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { INITIAL_FEN, closeAllClients, cmd, connect, delay, recordEvents, testTiming, waitFor } from "./helpers";
import {
  DB_SKIP,
  adminDb,
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

const GRACE_MS = 400;
const LINE = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]; // five plies: Black to move, more than 2 (abandoned, not aborted)

const servers: DbServer[] = [];
/** A restore window no other suite's game moved in: each boot here restores its own journal files only. */
const ISOLATED_WINDOW_MS = 1;

async function boot(journalDir: string, resumeMaxWaitMs: number): Promise<DbServer> {
  const timing = testTiming({ graceMs: GRACE_MS, graceFlappingMs: GRACE_MS, resumeMaxWaitMs }, { checkpointMaxAgeMs: 300 });
  // Only this test's own journal files are restored: the shared database holds other suites' live games (pnpm -r
  // test:int runs files in parallel), which a short resume wait here would resume and freeze under them.
  const s = await startDbServer({ journalDir, timing, restoreWindowMs: ISOLATED_WINDOW_MS });
  servers.push(s);
  return s;
}

/** A game five plies in, then the SIGTERM drain; resolves with the clocks frozen by the drain. */
async function playThenDrain(dir: string) {
  const a = await boot(dir, 60_000);
  const g = await startDbGame(a);
  await playLine(g.W, g.B, g.game.ref, LINE);
  const frozen = waitFor(g.W, "clock:sync", 3_000, (p) => p.frozen !== undefined);
  await a.booted.stop();
  await a.sql.db.$disconnect();
  servers.splice(servers.indexOf(a), 1);
  const f = await frozen;
  return { ...g, drained: { w: f.clocks.w as number, b: f.clocks.b as number } };
}

async function join(url: string, u: Parameters<typeof connect>[1], ref: string) {
  const c = await connect(url, u);
  const seen = recordEvents(c.socket, ["presence:update", "clock:sync", "game:ended"]);
  const ack = await cmd(c.socket, "game:join", { ref });
  assert.equal(ack.ok, true, JSON.stringify(ack));
  return { socket: c.socket, ack, seen };
}

describe("restart vs grace (Postgres + journal)", { skip: DB_SKIP }, () => {
  afterEach(() => closeAllClients());
  after(async () => {
    for (const s of servers.splice(0)) await s.close();
    await disconnectAdmin();
  });

  test("both offline longer than the grace, back one after the other: resumes on the second attach, nobody abandoned", async () => {
    const dir = newJournalDir();
    const { w, b, game, drained } = await playThenDrain(dir);
    await delay(GRACE_MS * 3); // downtime: longer than the grace
    const c = await boot(dir, 10_000);
    assert.ok(c.booted.handle.registry.get(game.ref)?.state.frozen, "restored frozen");

    const W = await join(c.url, w, game.ref);
    assert.equal(W.ack.state.phase, "playing");
    await delay(GRACE_MS * 3); // White waits longer than a grace for Black
    assert.equal(c.booted.handle.registry.get(game.ref)?.phase, "playing", "not abandoned while frozen");
    assert.deepEqual(
      W.seen.filter((e) => e.event === "presence:update" && e.payload.graceEndsAt !== undefined),
      [],
      "no grace while the restored game waits for both",
    );

    const resumed = waitFor(W.socket, "clock:sync", 3_000, (p) => p.frozen === undefined);
    const B = await join(c.url, b, game.ref);
    const r = await resumed;
    assert.equal(r.clocks.run, "b");
    assert.ok(Math.abs(r.clocks.w - drained.w) < 50, `white clock kept: ${r.clocks.w} vs ${drained.w}`);
    assert.ok(Math.abs(r.clocks.b - drained.b) < 50, `black clock kept: ${r.clocks.b} vs ${drained.b}`);

    const ack = await cmd(B.socket, "game:move", { ref: game.ref, ply: 5, uci: "g8f6", clientMoveId: "rp-1" });
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(W.seen.filter((e) => e.event === "game:ended").length, 0);
  });

  test("the resume wait runs out with one side back: the other gets a fresh grace from the resume and can return", async () => {
    const dir = newJournalDir();
    const { w, b, game } = await playThenDrain(dir);
    await delay(GRACE_MS * 3);
    const resumeWait = 600;
    const c = await boot(dir, resumeWait);
    const W = await join(c.url, w, game.ref);
    const graced = await waitFor(W.socket, "presence:update", resumeWait + 2_000, (p) => p.side === "b" && p.graceEndsAt !== undefined);
    const resume = W.seen.find((e) => e.event === "clock:sync" && e.payload.frozen === undefined);
    assert.ok(resume, "resumed by the resume wait");
    const fromResume = graced.graceEndsAt - resume.payload.clocks.at;
    assert.ok(Math.abs(fromResume - GRACE_MS) <= 50, `grace counted from the resume: ${fromResume} ms`);

    await delay(GRACE_MS / 4);
    const B = await join(c.url, b, game.ref);
    assert.equal(B.ack.state.phase, "playing");
    await delay(GRACE_MS * 2);
    assert.equal(c.booted.handle.registry.get(game.ref)?.phase, "playing", "Black came back within its grace");
    assert.equal(W.seen.filter((e) => e.event === "game:ended").length, 0);
  });

  test("nobody back by the resume wait: no grace while both are away; the first one back starts the other's", async () => {
    const dir = newJournalDir();
    const { w, b, game } = await playThenDrain(dir);
    const c = await boot(dir, 300);
    await delay(300 + GRACE_MS * 3); // the resume wait and more than a grace pass with nobody connected
    assert.equal(c.booted.handle.registry.get(game.ref)?.phase, "playing", "nobody abandoned while both are away");

    const before = Date.now();
    const W = await join(c.url, w, game.ref);
    // Started by White's attach (before White's socket joins the room): White's join ack carries it.
    const g = W.ack.state.players.b.graceEndsAt as number | null;
    assert.equal(W.ack.state.players.b.online, false);
    assert.ok(g !== null, "Black's grace starts when White is back");
    assert.ok(g - before >= GRACE_MS - 50, `fresh grace: ends ${g - before} ms after White's return`);

    const B = await join(c.url, b, game.ref);
    assert.equal(B.ack.state.phase, "playing");
    await delay(GRACE_MS * 2);
    const row = await gameRow(game.id);
    assert.equal(row.status, "IN_PROGRESS");
  });

  test("a bare SIGTERM drain (no notice before): both hear the restart and the frozen clocks; nobody is told the other left", async () => {
    const a = await boot(newJournalDir(), 60_000);
    const { game, W, B } = await startDbGame(a);
    await playLine(W, B, game.ref, LINE);
    const seenW = recordEvents(W, ["server:restarting", "clock:sync", "presence:update"]);
    const seenB = recordEvents(B, ["server:restarting", "clock:sync", "presence:update"]);
    const closed = Promise.all([W, B].map((s) => new Promise<void>((resolve) => s.once("disconnect", () => resolve()))));
    await a.booted.stop();
    await a.sql.db.$disconnect();
    servers.splice(servers.indexOf(a), 1);
    await closed;
    for (const [who, seen] of [["White", seenW], ["Black", seenB]] as const) {
      assert.equal(seen.filter((e) => e.event === "server:restarting").length, 1, `${who} hears the restart (D11)`);
      assert.ok(seen.some((e) => e.event === "clock:sync" && e.payload.frozen), `${who} gets the frozen clocks`);
      assert.deepEqual(
        seen.filter((e) => e.event === "presence:update").map((e) => e.payload),
        [],
        `${who} is not told the other side left (D7)`,
      );
    }
  });

  test("the boot restore is one statement for any number of journal files; ended games' old journals are pruned", async () => {
    const dir = newJournalDir();
    const { game } = await playThenDrain(dir); // one live game with a journal
    const [w, b] = [await makeUser("w"), await makeUser("b")];
    const old = Date.now() - 2 * 60 * 60 * 1000;
    const ended: { ref: string; recent: boolean }[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await makeGame(w, b);
      await adminDb().$executeRaw(Prisma.sql`UPDATE games SET status = 'COMPLETED', "completedAt" = now() WHERE id = ${g.id}`);
      const at = Date.now();
      const lines = [
        { t: "open", v: 1, at, ref: g.ref, startFen: INITIAL_FEN, tc: { i: 300000, inc: 0 }, colors: { w: w.ref, b: b.ref }, studyS: 0 },
        { t: "phase", at, phase: "playing" },
        { t: "ply", n: 1, uci: "e2e4", san: "e4", clk: 300000, spent: 0, at },
        { t: "end", at, method: "resign", winner: "b", ply: 1 },
      ];
      const file = pathJoin(dir, `${g.ref}.ndjson`);
      writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      const recent = i === 0;
      if (!recent) utimesSync(file, old / 1000, old / 1000); // finished two hours ago
      ended.push({ ref: g.ref, recent });
    }

    const c = await startDbServer({ journalDir: dir, restore: false, restoreWindowMs: ISOLATED_WINDOW_MS, timing: testTiming({ resumeMaxWaitMs: 60_000 }) });
    servers.push(c);
    const before = c.sql.queries();
    const report = await restoreAtBoot({
      db: c.sql.db,
      journal: c.booted.journal,
      registry: c.booted.handle.registry,
      persistence: c.booted.persistence,
      timing: testTiming(),
      now: Date.now,
      log: SILENT_LOGGER,
      metrics: createMemoryMetrics(),
      windowMs: ISOLATED_WINDOW_MS, // only the journal files are candidates
    });
    assert.equal(c.sql.queries() - before, 1, "one statement loads every candidate");
    assert.deepEqual(report.restored, [game.ref]);
    assert.equal(report.endedInDb, 6);
    assert.equal(report.candidates, 7);
    for (const e of ended) {
      assert.equal(existsSync(pathJoin(dir, `${e.ref}.ndjson`)), e.recent, `${e.recent ? "recent" : "old"} ended journal ${e.recent ? "kept" : "pruned"}`);
    }
  });
});
