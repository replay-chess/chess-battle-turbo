/**
 * Statement and payload budgets of the P5 routes on a real Postgres (phase-05 plan §9.1 "Statements", §9.4 "Payload
 * budgets", §15 "statement and payload budgets"; REGRESSION-5). `CT/http/train.size.test.ts` sizes the contract
 * fixtures; this file sizes what the routes really answer for the `bank-member` and `puzzles-fresh` personas, and counts
 * the statements each route runs (route()'s own Prisma timing store; the viewer comes from the harness, so the counts
 * are the route's statements after `getViewer()`, the plan's "RT" base).
 *
 * Every test reports what it measured (node:test diagnostics) and checks all of its budgets at the end, so one run shows
 * every number.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { after, before, describe, it, type TestContext } from "node:test";
import { ok } from "@repo/contracts/http/envelope";
import { AttemptsResult, SessionPayload, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { P5_PAYLOAD_BUDGETS as B } from "@repo/contracts/http/train-budgets";
import { startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { routeStatements } from "../../helpers/query-counter";
import { trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
/**
 * Statement ceilings per route, held as regression guards. §9.1's latency budget is its round-trip column: every read
 * path here runs its statements in ONE parallel batch (`Promise.all` on the pooled client, connection_limit 5), so its
 * round trips match §9.1 even where it reads more rows' worth of statements than §9.1's design count (noted per route).
 * W1 meets §9.1 outright (FIX-2: the member lock, one locked read, one write statement, the due read; ≈ 7 in the plan).
 */
const STATEMENTS = {
  todayFirst: 8, // 1 RT + the once-a-day plan read and write (§9.1: 1 RT, +2 once a day)
  todayLater: 5, // 1 RT (§9.1: 5 parallel)
  badges: 1, // §9.1: the count inside the shell CTE; R8 alone is 1
  bank: 5, // 1 RT (§9.1: 2 parallel; the profile, mastery, day, due summary and rows are one batch)
  home: 10, // 1 RT (§9.1: 6 parallel, h6 cached)
  sessionBank: 11, // §9.1: 3 parallel reads + 1 write tx; FIX-1 added the per-member lock and the reuse/limit re-check in the tx
  attempts: 5, // §9.1: ≈ 7 inside the tx. FIX-2: 4 (the member lock, locked read, write, due read), +1 when a touched day's plan is open
  summary: 6, // 1 RT (FIX-1: the attempts by the session's ref in the same batch; §9.1: session PK + attempts range)
} as const;

/** Raw and gzip bytes of a response body. */
async function sizeOf(res: Response): Promise<{ raw: number; gzip: number; text: string }> {
  const text = await res.clone().text();
  return { raw: Buffer.byteLength(text), gzip: gzipSync(Buffer.from(text)).length, text };
}

/** Collects `measured ≤ budget` checks, reports each one, then fails once with every check over budget. */
function budgets(t: TestContext) {
  const rows: { what: string; value: number; max: number }[] = [];
  return {
    check(what: string, value: number, max: number) {
      rows.push({ what, value, max });
      t.diagnostic(`${what}: ${value} (budget ${max})`);
    },
    done() {
      const over = rows.filter((r) => r.value > r.max);
      assert.deepEqual(over.map((r) => `${r.what}: ${r.value} > ${r.max}`), []);
    },
  };
}

describe("P5 statement and payload budgets (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  let shards: Awaited<ReturnType<typeof startPuzzleShardServer>>;
  let env: Record<string, string>;
  before(async () => {
    await w.setup();
    shards = await startPuzzleShardServer({ port: 0 });
    env = { PUZZLE_SHARD_BASE_URL: shards.baseUrl, PUZZLES_VERSION: "v1" };
  });
  after(async () => {
    await shards.close();
    await w.teardown();
  });

  const create = (m: Member, body: unknown, now = WORLD_NOW) =>
    w.call("sessions", "POST", "/api/train/sessions", m, { body, headers: { "Idempotency-Key": w.uuid() }, now, env });

  function attempt(session: SessionPayload, item: TrainItem, at: Date): AttemptIn {
    return {
      clientAttemptId: w.uuid(),
      sessionRef: session.ref,
      itemId: item.itemId,
      cardRef: item.cardRef,
      puzzleId: item.puzzleId,
      kind: item.kind,
      solved: true,
      firstTry: true,
      hintsUsed: 0,
      wrongMovesUci: [],
      solutionShown: false,
      timeMs: 9_000,
      grade: "good",
      suggestedGrade: "good",
      cardReps: item.cardReps,
      reviewedAt: at.toISOString(),
    };
  }

  it("R1 today and R8 badges", async (t) => {
    const b = budgets(t);
    const m = await w.member("bud-today");
    await w.persona(m, "bank-member");
    const first = await w.call("today", "GET", "/api/train/today", m);
    assert.equal(first.res.status, 200, await first.res.clone().text());
    b.check("R1 first read of the day, statements", routeStatements(first.recorded), STATEMENTS.todayFirst);
    const second = await w.call("today", "GET", "/api/train/today", m, { now: new Date(WORLD_NOW.getTime() + MIN) });
    assert.equal(second.res.status, 200);
    b.check("R1 later read, statements", routeStatements(second.recorded), STATEMENTS.todayLater);
    const s = await sizeOf(second.res);
    b.check("R1 raw bytes", s.raw, B.today.raw);
    b.check("R1 gzip bytes", s.gzip, B.today.gzip);
    const badges = await w.call("badges", "GET", "/api/me/badges", m);
    assert.equal(badges.res.status, 200);
    b.check("R8 statements", routeStatements(badges.recorded), STATEMENTS.badges);
    b.check("R8 envelope bytes", Buffer.byteLength(JSON.stringify({ data: (JSON.parse(await badges.res.clone().text()) as { data: unknown }).data })), B.badges.raw);
    b.done();
  });

  it("R2 bank (≤ 300 cards)", async (t) => {
    const b = budgets(t);
    const m = await w.member("bud-bank");
    await w.persona(m, "bank-member");
    const r = await w.call("bank", "GET", "/api/train/bank", m, { query: { view: "all" } });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    b.check("R2 statements", routeStatements(r.recorded), STATEMENTS.bank);
    const s = await sizeOf(r.res);
    const rows = (JSON.parse(s.text) as { data: { rows: unknown[] } }).data.rows.length;
    assert.ok(rows > 0 && rows <= 50, `${rows} rows (the 50-row budget)`);
    b.check(`R2 raw bytes (${rows} rows)`, s.raw, B.bank50.raw);
    b.check(`R2 gzip bytes (${rows} rows)`, s.gzip, B.bank50.gzip);
    // A full 50-row page of this member, projected from the real answer (the whole body scaled: conservative).
    b.check("R2 gzip bytes projected to 50 rows", Math.ceil((s.gzip * 50) / rows), B.bank50.gzip);
    b.done();
  });

  it("HOME-1", async (t) => {
    const b = budgets(t);
    const m = await w.member("bud-home");
    await w.persona(m, "bank-member");
    const r = await w.call("home", "GET", "/api/home", m);
    assert.equal(r.res.status, 200, await r.res.clone().text());
    b.check("HOME-1 statements", routeStatements(r.recorded), STATEMENTS.home);
    const s = await sizeOf(r.res);
    b.check("HOME-1 raw bytes", s.raw, B.home.raw);
    b.check("HOME-1 gzip bytes", s.gzip, B.home.gzip);
    b.done();
  });

  it("W2 BANK, W1 attempts, R3 summary", async (t) => {
    const b = budgets(t);
    const m = await w.member("bud-sess");
    await w.persona(m, "bank-member");
    const r = await create(m, { kind: "bank", source: "hub" });
    assert.equal(r.res.status, 201, await r.res.clone().text());
    b.check("W2 BANK statements", routeStatements(r.recorded), STATEMENTS.sessionBank);
    const s = await sizeOf(r.res);
    const p = ok(SessionPayload).parse(JSON.parse(s.text)).data;
    assert.ok(p.items.length > 0 && p.items.length <= 10);
    b.check(`W2 BANK raw bytes (${p.items.length} items)`, s.raw, B.session10.raw);
    b.check(`W2 BANK gzip bytes (${p.items.length} items)`, s.gzip, B.session10.gzip);

    const at = new Date(WORLD_NOW.getTime() + MIN);
    const attempts = p.items.map((it, i) => attempt(p, it, new Date(at.getTime() + i * MIN)));
    b.check(`W1 body bytes (${attempts.length} items)`, Buffer.byteLength(JSON.stringify({ attempts })), B.attemptsBody50.raw);
    const a = await w.call("attempts", "POST", "/api/train/attempts", m, { body: { attempts }, now: new Date(at.getTime() + 10 * MIN) });
    assert.equal(a.res.status, 200, await a.res.clone().text());
    const as = await sizeOf(a.res);
    assert.deepEqual(ok(AttemptsResult).parse(JSON.parse(as.text)).data.results.map((x) => x.status), attempts.map(() => "ok"));
    b.check("W1 result raw bytes", as.raw, B.attemptsResult50.raw);
    b.check("W1 result gzip bytes", as.gzip, B.attemptsResult50.gzip);
    b.check("W1 statements", routeStatements(a.recorded), STATEMENTS.attempts);

    const end = await w.call("end", "POST", `/api/train/sessions/${p.ref}/end`, m, { params: { ref: p.ref }, body: { reason: "done" }, now: new Date(at.getTime() + 11 * MIN) });
    assert.equal(end.res.status, 200, await end.res.clone().text());
    const again = await w.call("session", "GET", `/api/train/sessions/${p.ref}`, m, { params: { ref: p.ref }, query: { include: "summary" }, now: new Date(at.getTime() + 12 * MIN) });
    assert.equal(again.res.status, 200);
    b.check("R3 summary statements", routeStatements(again.recorded), STATEMENTS.summary);
    b.done();
  });

  it("W2 PUZZLES: 10 items, then 20 after an extend", async (t) => {
    const b = budgets(t);
    const m = await w.member("bud-puz");
    await w.persona(m, "puzzles-fresh");
    const r = await create(m, { kind: "puzzles", source: "nav", theme: "fork" });
    assert.equal(r.res.status, 201, await r.res.clone().text());
    const s = await sizeOf(r.res);
    const p = ok(SessionPayload).parse(JSON.parse(s.text)).data;
    assert.equal(p.items.length, 10);
    b.check("W2 PUZZLES raw bytes (10 items)", s.raw, B.session10.raw);
    b.check("W2 PUZZLES gzip bytes (10 items)", s.gzip, B.session10.gzip);
    const last = p.items[p.items.length - 1]!.itemId;
    const e = await w.call("extend", "POST", `/api/train/sessions/${p.ref}/extend`, m, { params: { ref: p.ref }, body: { after: last }, env });
    assert.equal(e.res.status, 200, await e.res.clone().text());
    const r3 = await w.call("session", "GET", `/api/train/sessions/${p.ref}`, m, { params: { ref: p.ref } });
    const s3 = await sizeOf(r3.res);
    assert.equal(ok(SessionPayload).parse(JSON.parse(s3.text)).data.items.length, 20);
    b.check("R3 PUZZLES raw bytes (20 items)", s3.raw, B.session20.raw);
    b.check("R3 PUZZLES gzip bytes (20 items)", s3.gzip, B.session20.gzip);
    b.done();
  });
});
