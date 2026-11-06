// regression: FIX-A (review-rules restore-dbdown). If the DB load failed for a game during the boot restore (Neon
// unreachable at boot), the first join built the session from the DB row alone and its first journal line rewrote the
// journal from that shorter state. The restore now defers such a game to its first successful load.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { foldJournal, type JournalLine } from "@repo/game-core";
import type { LiveSession } from "../src/game/LiveSession";
import { SessionRegistry } from "../src/game/SessionRegistry";
import { Journal, parseJournal, snapshotLines } from "../src/persist/journal";
import { restoreAtBoot } from "../src/persist/restore";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { MemoryPersistence, MemoryTelemetry, record, testTiming, user } from "./helpers";
import { Live } from "../../../packages/game-core/test/helpers";

test("journal plies survive a boot where the DB load of that game failed once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rc-journal-probe-"));
  const w = user("w");
  const b = user("b");
  const rec = record({ white: w, black: b, phase: "PLAYING", moves: "e2e4 e7e5" }); // last checkpoint: 2 plies
  rec.lastMoveAt = new Date();
  // The journal of the crashed process holds 6 plies.
  const g = new Live({ ref: rec.ref }).join().firstMoves("e2e4", "e7e5");
  for (const [s, m] of [["w", "g1f3"], ["b", "b8c6"], ["w", "f1b5"], ["b", "a7a6"]] as const) g.move(s, m, 1_000);
  writeFileSync(join(dir, `${rec.ref}.ndjson`), snapshotLines(g.s, Date.now()).map((l) => JSON.stringify(l)).join("\n") + "\n");

  const metrics = createMemoryMetrics();
  const journal = new Journal({ dir, now: Date.now, log: SILENT_LOGGER, metrics, fsyncEveryMs: 5 });
  await journal.init();
  let dbDown = true;
  class P extends MemoryPersistence {
    override async load(ref: string) {
      if (dbDown) throw Object.assign(new Error("Can't reach database server"), { code: "P1001" });
      return super.load(ref);
    }
    override journal(session: LiveSession, line: JournalLine): void {
      journal.append(session, line);
    }
  }
  const persistence = new P();
  persistence.add(rec);
  const timing = testTiming();
  const registry = new SessionRegistry({
    emit() {},
    now: Date.now,
    timing,
    persistence,
    telemetry: new MemoryTelemetry(),
    metrics,
    log: SILENT_LOGGER,
    appEnv: "test",
  });
  const fakeDb = { $queryRaw: async () => [{ ref: rec.ref }], $executeRaw: async () => 0 };
  const report = await restoreAtBoot({
    db: fakeDb as never,
    journal,
    registry,
    persistence: Object.assign(persistence, { writeNow: async () => true, flushAll: async () => {}, stats: () => ({}) }) as never,
    timing,
    now: Date.now,
    log: SILENT_LOGGER,
    metrics,
  });
  assert.deepEqual(report.deferred, [rec.ref]);

  dbDown = false; // Neon is back a moment later; a player reconnects.
  const opened = await registry.open(rec.ref);
  assert.ok(opened.ok);
  const session = opened.session;
  session.dispatch({ type: "attach", side: "w", socketId: "s1" });
  await journal.sync();
  const onDisk = foldJournal(parseJournal(readFileSync(join(dir, `${rec.ref}.ndjson`), "utf8")));
  await journal.close();
  registry.destroyAll();
  assert.equal(session.state.moves.length, 6, "the 4 journal-only plies survive");
  assert.equal(onDisk.moves.length, 6, "the journal file is continued, not rewritten");
});
