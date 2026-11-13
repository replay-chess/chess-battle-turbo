// lib/jobs/import.ts: the statements' shape and the runners with a fake client (the Postgres behaviour, incl. the
// idempotent re-send of the release and the RUNNING → null path, is in test/api/accounts.contract.int.test.ts).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { KickBodyV1 } from "@repo/contracts/internal/kick";
import type { Prisma } from "@repo/db";
import { setKickTransport } from "@/lib/services/analysis/kick";
import {
  IMPORT_KICK_KINDS,
  enqueueImport,
  enqueueImportSql,
  healImportKick,
  healImportKickSql,
  kickImports,
  releaseWaitingImports,
  releaseWaitingImportsSql,
} from "./import";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const flat = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, " ");

function fakeDb(rows: unknown[]) {
  const seen: Prisma.Sql[] = [];
  return {
    seen,
    $queryRaw: async <T>(q: Prisma.Sql) => {
      seen.push(q);
      return rows as T;
    },
    $executeRaw: async () => 0,
  };
}

describe("enqueueImportSql", () => {
  it("IMPORT_SYNC on import:<id>, requeue policy, the payload and max attempts", () => {
    const sql = enqueueImportSql({ linkedAccountId: 42n, userId: 7n, runId: 9n, trigger: "MANUAL", priority: JOB_PRIORITY.IMPORT_SYNC_MANUAL, runAt: NOW });
    const text = flat(sql);
    assert.match(text, /INSERT INTO jobs/);
    assert.match(text, /ON CONFLICT \("dedupeKey"\) DO UPDATE SET/);
    assert.match(text, /WHERE jobs\.status <> 'RUNNING'/);
    assert.ok(sql.values.includes("IMPORT_SYNC"));
    assert.ok(sql.values.includes("import:42"));
    assert.ok(sql.values.includes(JOB_PRIORITY.IMPORT_SYNC_MANUAL));
    assert.ok(sql.values.includes(JSON.stringify({ v: 1, linkedAccountId: "42", runId: "9", trigger: "MANUAL" })));
    assert.ok(sql.values.includes(5), "maxAttempts 5");
    assert.ok(sql.values.includes(NOW.toISOString()));
  });

  it("a DAILY sync carries runId null; unknown triggers and literal priorities are refused", () => {
    const sql = enqueueImportSql({ linkedAccountId: 1n, userId: 1n, runId: null, trigger: "DAILY", priority: JOB_PRIORITY.IMPORT_SYNC_DAILY });
    assert.ok(sql.values.includes(JSON.stringify({ v: 1, linkedAccountId: "1", runId: null, trigger: "DAILY" })));
    assert.throws(() => enqueueImportSql({ linkedAccountId: 1n, userId: 1n, runId: null, trigger: "NOPE" as never, priority: 100 }));
    assert.throws(() => enqueueImportSql({ linkedAccountId: 1n, userId: 1n, runId: null, trigger: "DAILY", priority: 77 as never }));
  });

  it("enqueueImport maps the returned row and null when nothing came back (RUNNING)", async () => {
    const input = { linkedAccountId: 3n, userId: 4n, runId: 5n, trigger: "INITIAL" as const, priority: JOB_PRIORITY.IMPORT_SYNC_INITIAL };
    const job = await enqueueImport(fakeDb([{ id: "11", status: "QUEUED", priority: 60, runAtMs: NOW.getTime(), attempts: 0, created: true }]), input);
    assert.deepEqual(job, { id: 11n, status: "QUEUED", priority: 60, runAt: NOW, attempts: 0, created: true });
    assert.equal(await enqueueImport(fakeDb([]), input), null);
  });
});

describe("releaseWaitingImportsSql (§8.5.4 step 2)", () => {
  it("one statement: waiting runs, their accounts, returning-member DAILY syncs and the job upsert", () => {
    const sql = releaseWaitingImportsSql(7n, NOW);
    const text = flat(sql);
    assert.match(text, /^WITH rel AS \( UPDATE import_runs SET status = 'QUEUED'/);
    assert.match(text, /status = 'WAITING_FOR_MEMBERSHIP' RETURNING id, "linkedAccountId", trigger/);
    assert.match(text, /acc AS \( UPDATE linked_accounts SET "importState" = 'QUEUED'/);
    assert.match(text, /ret AS \( SELECT la\.id AS "linkedAccountId" FROM linked_accounts la WHERE la\."userId" = \$\d+::bigint AND la\."autoImport"/);
    assert.match(text, /INSERT INTO jobs .* 'IMPORT_SYNC'::"JobKind"/);
    assert.match(text, /ON CONFLICT \("dedupeKey"\) DO UPDATE SET .* WHERE jobs\.status <> 'RUNNING'/);
    assert.match(text, /SELECT \(SELECT count\(\*\) FROM rel\)::int AS released, \(SELECT count\(\*\) FROM j\)::int AS queued/);
    assert.ok(sql.values.includes(JOB_PRIORITY.IMPORT_SYNC_INITIAL));
    assert.ok(sql.values.includes(JOB_PRIORITY.IMPORT_SYNC_DAILY));
    assert.ok(sql.values.includes(7n));
    assert.ok(sql.values.includes(NOW.toISOString()));
    assert.equal(sql.values.includes(100), false, "no manual priority");
  });

  it("the runner returns numbers", async () => {
    const db = fakeDb([{ released: 2n, queued: 3, accounts: 3 }]);
    assert.deepEqual(await releaseWaitingImports(db, 7n, { now: NOW }), { released: 2, queued: 3 });
    assert.deepEqual(await releaseWaitingImports(fakeDb([]), 7n), { released: 0, queued: 0 });
  });
});

describe("kicks", () => {
  let restore: (() => void) | null = null;
  afterEach(() => restore?.());

  it("kickImports sends a valid KickBodyV1 naming the I/O kinds", async () => {
    const sent: string[] = [];
    restore = setKickTransport(async (_url, init) => {
      sent.push(String(init.body));
      return new Response(null, { status: 202 });
    });
    const env = { ANALYSIS_WORKER_URL: "http://worker.test", INTERNAL_API_SECRET: `webwk:${"k".repeat(64)}` };
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      const r = await kickImports("import_retry", { runAt: NOW });
      assert.equal(r.ok, true);
    } finally {
      for (const k of Object.keys(env)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
    const body = KickBodyV1.parse(JSON.parse(sent[0]!));
    assert.deepEqual(body, { v: 1, reason: "import_retry", kinds: [...IMPORT_KICK_KINDS], runAt: NOW.toISOString() });
  });

  it("two kicks in one second without a runAt carry different bodies and signatures (no HMAC replay refusal)", async () => {
    const sent: { body: string; sig: string }[] = [];
    restore = setKickTransport(async (_url, init) => {
      const headers = new Headers(init.headers as HeadersInit);
      sent.push({ body: String(init.body), sig: headers.get("x-rc-sig") ?? "" });
      return new Response(null, { status: 202 });
    });
    const env = { ANALYSIS_WORKER_URL: "http://worker.test", INTERNAL_API_SECRET: `webwk:${"k".repeat(64)}` };
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
      const t = Date.UTC(2026, 10, 12, 16, 20, 32, 100);
      await kickImports("import", { nowMs: t });
      await kickImports("import", { nowMs: t + 870 });
    } finally {
      for (const k of Object.keys(env)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0]!.body, sent[1]!.body);
    assert.ok(sent[0]!.sig && sent[1]!.sig);
    assert.notEqual(sent[0]!.sig, sent[1]!.sig);
    assert.equal(KickBodyV1.parse(JSON.parse(sent[0]!.body)).runAt, "2026-11-12T16:20:32.100Z");
  });

  it("healImportKickSql is the 30 s CAS on one import key; garbage keys are refused", () => {
    const text = flat(healImportKickSql("import:42"));
    assert.match(text, /^UPDATE jobs SET "lastKickAt" = \(now\(\) AT TIME ZONE 'UTC'\) WHERE "dedupeKey" = \$1 AND status = 'QUEUED'/);
    assert.match(text, /\("lastKickAt" IS NULL OR "lastKickAt" < /);
    assert.throws(() => healImportKickSql("analyze:1"));
    assert.throws(() => healImportKickSql("import:1; DROP"));
  });

  it("healImportKick kicks only when the CAS returned a row", async () => {
    let kicks = 0;
    restore = setKickTransport(async () => {
      kicks += 1;
      return new Response(null, { status: 202 });
    });
    assert.equal(await healImportKick(fakeDb([]), 42n), false);
    assert.equal(kicks, 0);
    const won = fakeDb([{ id: 1n }]);
    assert.equal(await healImportKick(won, 42n), true);
    assert.ok(won.seen[0]!.values.includes("import:42"));
  });
});
