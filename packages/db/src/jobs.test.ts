// Unit tests for the enqueue builders (no database). The upsert semantics against Postgres are in
// test/jobs.int.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Prisma } from "#generated";
import {
  JOB_KINDS,
  JOB_PRIORITY,
  JOB_STATUSES,
  enqueueAnalysis,
  enqueueAnalysisSql,
  enqueueJob,
  enqueueJobSql,
  type EnqueueJobInput,
  type JobPriority,
} from "./jobs";
import type { SqlClient } from "./live/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const flat = (s: Prisma.Sql) => s.text.replace(/\s+/g, " ");

const housekeeping = (over: Partial<EnqueueJobInput> = {}): EnqueueJobInput => ({
  kind: "HOUSEKEEPING",
  priority: JOB_PRIORITY.HOUSEKEEPING,
  payload: { v: 1, day: "2026-11-12" },
  dedupeKey: "housekeeping:2026-11-12",
  runAt: new Date("2026-11-12T21:00:00.000Z"),
  ...over,
});

/** A fake client that records the statement and answers like the Neon HTTP driver (ids and times as strings). */
function fakeDb(rows: Record<string, unknown>[]): SqlClient & { last?: Prisma.Sql } {
  const db: SqlClient & { last?: Prisma.Sql } = {
    $queryRaw<T>(query: Prisma.Sql) {
      db.last = query;
      return Promise.resolve(rows as T);
    },
    $executeRaw() {
      return Promise.resolve(0);
    },
  };
  return db;
}

describe("schema parity", () => {
  const schema = readFileSync(path.join(here, "../prisma/schema.prisma"), "utf8");
  const enumValues = (name: string) => {
    const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
    assert.ok(m, `enum ${name} in schema.prisma`);
    return m[1]!
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, "").trim())
      .filter(Boolean);
  };

  it("JobKind and JobStatus in schema.prisma equal the contracts' JOB_KINDS / JOB_STATUSES", () => {
    assert.deepEqual(enumValues("JobKind"), [...JOB_KINDS]);
    assert.deepEqual(enumValues("JobStatus"), [...JOB_STATUSES]);
  });

  it("the M3 enums carry exactly the plan's values", () => {
    assert.deepEqual(enumValues("AnalysisStatus"), ["NONE", "QUEUED", "RUNNING", "DONE", "FAILED", "SKIPPED"]);
    assert.equal(enumValues("Judgement").length, 12);
    assert.deepEqual(enumValues("ShareKind"), ["POSITION", "REVIEW"]);
    assert.deepEqual(enumValues("ComparisonStatus"), ["FACTS_READY", "NARRATING", "READY", "FAILED"]);
  });
});

describe("enqueueJobSql validation", () => {
  it("accepts only JOB_PRIORITY values", () => {
    assert.throws(() => enqueueJobSql(housekeeping({ priority: 42 as JobPriority })), /JOB_PRIORITY/);
    assert.doesNotThrow(() => enqueueJobSql(housekeeping({ priority: JOB_PRIORITY.BACKLOG })));
  });

  it("rejects an unknown kind, a bad fairSeq, a long dedupeKey and reviveDone without raise", () => {
    assert.throws(() => enqueueJobSql(housekeeping({ kind: "HOURLY_TICK" as "HOUSEKEEPING" })), /unknown kind/);
    assert.throws(() => enqueueJobSql(housekeeping({ fairSeq: -1 })), /fairSeq/);
    assert.throws(() => enqueueJobSql(housekeeping({ fairSeq: 1.5 })), /fairSeq/);
    assert.throws(() => enqueueJobSql(housekeeping({ dedupeKey: "x".repeat(121) })), /dedupeKey/);
    assert.throws(() => enqueueJobSql(housekeeping({ dedupeKey: "" })), /dedupeKey/);
    assert.throws(() => enqueueJobSql(housekeeping({ reviveDone: true })), /reviveDone/);
    assert.throws(() => enqueueJobSql(housekeeping({ runAt: new Date("nope") })), /invalid Date/);
  });

  it("validates P3 payloads against their contract schema and other kinds for an integer v", () => {
    assert.throws(() => enqueueJobSql(housekeeping({ payload: { v: 1, day: "12/11/2026" } })));
    assert.throws(() =>
      enqueueJobSql({ kind: "IMPORT_SYNC", priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL, payload: { v: 0 } }),
    );
    assert.doesNotThrow(() =>
      enqueueJobSql({ kind: "IMPORT_SYNC", priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL, payload: { v: 1, runId: "r1" } }),
    );
  });

  it("writes maxAttempts per kind (ANALYZE_GAME 4, LEGEND_COMPARE 3, HOUSEKEEPING 2, others the default 4)", () => {
    assert.ok(enqueueJobSql(housekeeping()).values.includes(2));
    const legend = enqueueJobSql({
      kind: "LEGEND_COMPARE",
      priority: JOB_PRIORITY.USER_OPENED,
      payload: { v: 1, gameId: "7", userId: "9", gameRef: "cabc" },
    });
    assert.ok(legend.values.includes(3));
    const other = enqueueJobSql({ kind: "EXPORT_BUILD", priority: JOB_PRIORITY.BACKLOG, payload: { v: 1 } });
    assert.ok(other.values.includes(4));
    assert.ok(enqueueJobSql(housekeeping({ maxAttempts: 7 })).values.includes(7));
  });

  it("passes runAt as a UTC instant and defaults to now() in UTC", () => {
    const at = enqueueJobSql(housekeeping());
    assert.ok(at.values.includes("2026-11-12T21:00:00.000Z"));
    assert.match(flat(at), /::timestamptz AT TIME ZONE 'UTC'/);
    assert.match(flat(enqueueJobSql(housekeeping({ runAt: null }))), /\(now\(\) AT TIME ZONE 'UTC'\)/);
  });
});

describe("conflict policies", () => {
  it("keep = DO NOTHING (the default)", () => {
    assert.match(flat(enqueueJobSql(housekeeping())), /ON CONFLICT \("dedupeKey"\) DO NOTHING RETURNING/);
  });

  it("raise updates live rows only; reviveDone adds DONE", () => {
    const raise = flat(enqueueJobSql(housekeeping({ onConflict: "raise" })));
    assert.match(raise, /DO UPDATE SET priority = CASE WHEN jobs\.status IN \('QUEUED', 'RUNNING'\) THEN GREATEST/);
    assert.match(raise, /WHERE jobs\.status IN \('QUEUED', 'RUNNING'\) RETURNING/);
    assert.match(raise, /WHEN jobs\.status = 'QUEUED' AND jobs\.attempts = 0 THEN LEAST\(jobs\."runAt", EXCLUDED\."runAt"\)/);
    const revive = flat(enqueueJobSql(housekeeping({ onConflict: "raise", reviveDone: true })));
    assert.match(revive, /WHERE jobs\.status IN \('QUEUED', 'RUNNING'\) OR jobs\.status = 'DONE' RETURNING/);
  });

  it("requeue resets every non-RUNNING row", () => {
    const requeue = flat(enqueueJobSql(housekeeping({ onConflict: "requeue" })));
    assert.match(requeue, /status = 'QUEUED'::"JobStatus", payload = EXCLUDED\.payload, attempts = 0/);
    assert.match(requeue, /WHERE jobs\.status <> 'RUNNING' RETURNING/);
  });

  it("is embeddable: one INSERT with no CTE of its own, guarded by `when`", () => {
    const sql = flat(
      enqueueJobSql(housekeeping({ when: Prisma.sql`EXISTS (SELECT 1 FROM lc)` })),
    );
    assert.match(sql, /^INSERT INTO jobs/);
    assert.doesNotMatch(sql, /^WITH/);
    assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM lc\) ON CONFLICT/);
  });
});

describe("enqueueAnalysisSql", () => {
  it("upserts analyze:<gameId> with the raise policy, guarded on a finished game with >= 6 plies", () => {
    const sql = enqueueAnalysisSql({ gameId: 42n, gameRef: "cgame42", priority: JOB_PRIORITY.USER_OPENED, reason: "opened" });
    const text = flat(sql);
    assert.ok(sql.values.includes("analyze:42"));
    assert.ok(sql.values.includes(JSON.stringify({ v: 1, gameId: "42", gameRef: "cgame42", reason: "opened" })));
    assert.match(text, /eg\.status = 'COMPLETED' AND eg\."plyCount" >= \$\d+ AND eg\."analysisStatus" <> 'SKIPPED'/);
    assert.ok(sql.values.includes(6));
    assert.doesNotMatch(text, /OR jobs\.status = 'DONE'/);
    assert.match(text, /UPDATE users u SET "gamesVersion" = u\."gamesVersion" \+ 1/);
  });

  it("only a regrade revives a DONE job", () => {
    const text = flat(enqueueAnalysisSql({ gameId: 1n, gameRef: "c1", priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" }));
    assert.match(text, /OR jobs\.status = 'DONE'/);
  });

  it("rejects a payload the contract would reject (bad gameRef)", () => {
    assert.throws(() => enqueueAnalysisSql({ gameId: 1n, gameRef: "", priority: JOB_PRIORITY.USER_OPENED, reason: "opened" }));
  });
});

describe("result mapping is driver-neutral", () => {
  it("maps Neon-style strings (bigint id, numeric text) to bigint, number and Date", async () => {
    const db = fakeDb([
      { id: "9007199254740993", status: "QUEUED", priority: "80", attempts: "0", runAtMs: "1794474000000", created: true },
    ]);
    const job = await enqueueJob(db, housekeeping({ priority: JOB_PRIORITY.GAME_ENDED }));
    assert.deepEqual(job, {
      id: 9007199254740993n,
      status: "QUEUED",
      priority: 80,
      runAt: new Date(1794474000000),
      attempts: 0,
      created: true,
    });
  });

  it("enqueueJob returns null when the statement returned no row", async () => {
    assert.equal(await enqueueJob(fakeDb([]), housekeeping()), null);
  });

  it("enqueueAnalysis maps the outcomes", async () => {
    const base = { id: 5n, status: "QUEUED", priority: 100, attempts: 0, runAtMs: 1794474000000, changed: 1, bumped: 2 };
    const input = { gameId: 5n, gameRef: "c5", priority: JOB_PRIORITY.USER_OPENED, reason: "opened" } as const;
    assert.deepEqual(await enqueueAnalysis(fakeDb([]), input), { outcome: "ineligible" });
    const job = { id: 5n, status: "QUEUED", priority: 100, attempts: 0, runAt: new Date(1794474000000), created: true };
    assert.deepEqual(await enqueueAnalysis(fakeDb([{ ...base, created: true, kept: false }]), input), {
      outcome: "created",
      job,
      statusChanged: true,
    });
    assert.deepEqual(await enqueueAnalysis(fakeDb([{ ...base, changed: 0, created: false, kept: false }]), input), {
      outcome: "updated",
      job: { ...job, created: false },
      statusChanged: false,
    });
    assert.deepEqual(await enqueueAnalysis(fakeDb([{ ...base, status: "FAILED", created: false, kept: true }]), input), {
      outcome: "unchanged",
      job: { ...job, status: "FAILED", created: false },
    });
  });

  it("rejects a status the enum does not have", async () => {
    const db = fakeDb([{ id: 1, status: "LOST", priority: 0, attempts: 0, runAtMs: 0, created: false }]);
    await assert.rejects(enqueueJob(db, housekeeping()), /unknown status/);
  });
});
