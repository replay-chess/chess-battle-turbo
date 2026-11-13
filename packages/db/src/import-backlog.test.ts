// The backlog release statement's shape (phase-04 plan 8.9): one statement, the priority from JOB_PRIORITY (no
// literal), the analyse cap and spread as parameters, idempotent ON CONFLICT DO NOTHING; the env defaults.
// Its behaviour on Postgres is test/import-backlog.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { backlogSettingsFromEnv, releaseImportBacklogSql, toBacklogRelease } from "./import-backlog";

describe("releaseImportBacklogSql", () => {
  it("is one WITH statement that inserts BACKLOG jobs once and flips the games", () => {
    const sql = releaseImportBacklogSql({ userId: 42n, now: new Date("2026-11-10T12:00:00Z"), cap: 200, spreadDays: 7 });
    assert.equal(sql.sql.split(";").length, 1);
    assert.match(sql.sql, /^WITH clock AS/);
    assert.match(sql.sql, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
    assert.match(sql.sql, /ntile\(/);
    assert.match(sql.sql, /UPDATE games SET "analysisStatus" = 'QUEUED'/);
    assert.ok(sql.values.includes(JOB_PRIORITY.BACKLOG));
    assert.ok(sql.values.includes(200) && sql.values.includes(7));
    assert.ok(sql.values.includes("2026-11-10T12:00:00.000Z"));
    assert.doesNotMatch(sql.sql, /priority[^,]*\b10\b/, "no priority literal");
  });

  it("refuses bad settings and maps rows driver-neutrally", () => {
    assert.throws(() => releaseImportBacklogSql({ userId: 1n, cap: -1 }));
    assert.throws(() => releaseImportBacklogSql({ userId: 1n, spreadDays: 0 }));
    assert.throws(() => releaseImportBacklogSql({ userId: 1n, now: new Date("nope") }));
    const r = toBacklogRelease([
      { runAtMs: "1794697500000", games: "26" },
      { runAtMs: 1794783900000, games: 25 },
    ]);
    assert.equal(r.queued, 51);
    assert.equal(r.slots[0]!.runAt.toISOString(), "2026-11-14T23:05:00.000Z");
  });

  it("reads the D4-09 defaults from the environment", () => {
    assert.deepEqual(backlogSettingsFromEnv({}), { cap: 200, spreadDays: 7 });
    assert.deepEqual(backlogSettingsFromEnv({ IMPORT_ANALYSE_CAP: "50", IMPORT_BACKLOG_SPREAD_DAYS: "3" }), { cap: 50, spreadDays: 3 });
    assert.deepEqual(backlogSettingsFromEnv({ IMPORT_ANALYSE_CAP: "-5", IMPORT_BACKLOG_SPREAD_DAYS: "1.5" }), { cap: 200, spreadDays: 7 });
  });
});
