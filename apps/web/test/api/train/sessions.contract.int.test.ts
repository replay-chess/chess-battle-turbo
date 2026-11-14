/**
 * W2 `POST /api/train/sessions`, R3, W3 extend and W4 end on a real Postgres (phase-05 plan §12.2 "W2 sessions",
 * "W3/W4/R3"): the Idempotency-Key replay and reuse rules, ACTIVE reuse (< 2 h, not fully graded), explicit picks,
 * practice, the empty answers, puzzles from the CI shard server (cold and warm, widening, the 400-a-day fair use, a shard
 * outage → 502), a theme switch abandoning the previous puzzle session, the durable hourly session limit (counted from
 * `training_sessions`, so it holds after `TRUNCATE rate_limit_buckets`), the after-Again previews, extend idempotency
 * and 409 `session_ended`, end twice → the same summary, 404 for another member's refs.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { ExtendResult, SessionPayload, SessionSummary } from "@repo/contracts/http/train";
import { PuzzleManifestSchema } from "@/lib/train/puzzle-shards";
import { openSession } from "@/lib/train/sessions.server";
import { trainDeps } from "@/lib/train/db.server";
import { SHARD_FIXTURES_DIR, startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { installTestDeps } from "../../helpers/route-harness";
import { count, nonMember, trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const HOUR = 3_600_000;

describe("P5 W2/W3/W4/R3 sessions (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
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

  const create = (m: Member, body: unknown, init: { key?: string; now?: Date; viewer?: ReturnType<typeof w.viewerOf> } = {}) =>
    w.call("sessions", "POST", "/api/train/sessions", m, {
      body,
      headers: init.key === "" ? {} : { "Idempotency-Key": init.key ?? w.uuid() },
      now: init.now,
      env,
      ...(init.viewer ? { viewer: init.viewer } : {}),
    });

  it("bank: 201 with the due queue, previews and after-Again previews; a replayed key answers the same body", async () => {
    const m = await w.member("sess");
    await w.persona(m, "bank-member");
    const key = w.uuid();
    const r = await create(m, { kind: "bank", source: "hub" }, { key });
    assert.equal(r.res.status, 201, await r.res.clone().text());
    const p = ok(SessionPayload).parse(await r.json()).data;
    assert.equal(p.kind, "bank");
    assert.equal(p.status, "active");
    assert.equal(p.items.length, 4);
    assert.equal(p.capRemaining, 10);
    assert.equal(p.countsTowardCap, true);
    assert.equal(p.resumeIndex, 0);
    for (const it of p.items) {
      assert.ok(it.preview, "graded items carry previews");
      assert.ok(it.previewAfterAgain, "pass-1 items carry the after-Again previews");
      assert.equal(it.setup.length, 0);
      assert.ok(it.context);
    }
    const replay = await create(m, { kind: "bank", source: "hub" }, { key });
    assert.equal(replay.res.status, 201);
    assert.equal(replay.res.headers.get("idempotent-replayed"), "true");
    assert.equal(ok(SessionPayload).parse(await replay.json()).data.ref, p.ref);
    const reused = await create(m, { kind: "bank", source: "hub", filter: { theme: "fork" } }, { key });
    assert.equal(reused.res.status, 422);
    assert.equal(ErrorEnvelope.parse(await reused.json()).error.code, "idempotency_key_reused");
    const noKey = await create(m, { kind: "bank", source: "hub" }, { key: "" });
    assert.equal(noKey.res.status, 400);
  });

  it("ACTIVE reuse within 2 h (200, not counted); a new session after 2 h; practice never reuses", async () => {
    const m = await w.member("reuse");
    await w.persona(m, "bank-member");
    const a = ok(SessionPayload).parse(await (await create(m, { kind: "bank", source: "hub" })).json()).data;
    const again = await create(m, { kind: "bank", source: "bank" }, { now: new Date(WORLD_NOW.getTime() + 30 * 60_000) });
    assert.equal(again.res.status, 200);
    assert.equal(ok(SessionPayload).parse(await again.json()).data.ref, a.ref);
    const later = await create(m, { kind: "bank", source: "hub" }, { now: new Date(WORLD_NOW.getTime() + 2 * HOUR + 60_000) });
    assert.equal(later.res.status, 201);
    assert.notEqual(ok(SessionPayload).parse(await later.json()).data.ref, a.ref);
    const p1 = await create(m, { kind: "bank", source: "bank", practice: true });
    const p2 = await create(m, { kind: "bank", source: "bank", practice: true });
    assert.equal(p1.res.status, 201);
    assert.equal(p2.res.status, 201);
    const pp = ok(SessionPayload).parse(await p2.json()).data;
    assert.equal(pp.countsTowardCap, false);
  });

  it("explicit picks: cardRefs reuse only with the same key set and never count toward the cap; gameRef; foreign → 404", async () => {
    const m = await w.member("pick");
    const rep = await w.persona(m, "bank-member");
    const keys = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`SELECT "itemKey" FROM training_cards WHERE "userId" = ${m.id} ORDER BY id LIMIT 3`)).map((r) => r.itemKey);
    const one = ok(SessionPayload).parse(await (await create(m, { kind: "bank", source: "solve_one", cardRefs: [keys[0]] })).json()).data;
    assert.equal(one.countsTowardCap, false);
    assert.equal(one.capRemaining, null);
    assert.deepEqual(one.items.map((i) => i.cardRef), [keys[0]]);
    const same = await create(m, { kind: "bank", source: "bank", cardRefs: [keys[0]] });
    assert.equal(same.res.status, 200);
    const other = await create(m, { kind: "bank", source: "bank", cardRefs: [keys[0], keys[1]] });
    assert.equal(other.res.status, 201);
    const gameRef = rep.gameRefs.GAME ?? Object.values(rep.gameRefs)[0]!;
    const g = await create(m, { kind: "bank", source: "review_complete", gameRef });
    assert.equal(g.res.status, 201, await g.res.clone().text());
    assert.ok(ok(SessionPayload).parse(await g.json()).data.items.length > 0);

    const stranger = await w.member("stranger");
    await w.persona(stranger, "bank-empty");
    assert.equal((await create(stranger, { kind: "bank", source: "bank", cardRefs: [keys[0]] })).res.status, 404);
    assert.equal((await create(stranger, { kind: "bank", source: "review_complete", gameRef })).res.status, 404);
    assert.equal((await w.call("session", "GET", `/api/train/sessions/${one.ref}`, stranger, { params: { ref: one.ref } })).res.status, 404);
    assert.equal((await w.call("end", "POST", `/api/train/sessions/${one.ref}/end`, stranger, { params: { ref: one.ref }, body: { reason: "done" } })).res.status, 404);
    assert.equal((await create(stranger, { kind: "practice", fromSessionRef: one.ref })).res.status, 404);
  });

  it("nothing due → 201 with no items (caughtup); the cap used → cap_reached; a filter with nothing due → nothing_matches", async () => {
    const c = await w.member("emptys");
    await w.persona(c, "bank-caughtup");
    const caught = await create(c, { kind: "bank", source: "hub" });
    assert.equal(caught.res.status, 201);
    const cp = ok(SessionPayload).parse(await caught.json()).data;
    assert.deepEqual([cp.items.length, cp.empty], [0, "caughtup"]);
    const m = await w.member("capped");
    await w.persona(m, "bank-member");
    await w.db.$executeRaw(Prisma.sql`INSERT INTO training_days ("userId", day, "bankReviewed", "updatedAt") VALUES (${m.id}, '2026-11-12', 10, now())
      ON CONFLICT ("userId", day) DO UPDATE SET "bankReviewed" = 10`);
    const capped = ok(SessionPayload).parse(await (await create(m, { kind: "bank", source: "hub" })).json()).data;
    assert.deepEqual([capped.items.length, capped.empty], [0, "cap_reached"]);
    const n = await w.member("nomatch");
    await w.persona(n, "bank-member");
    const none = ok(SessionPayload).parse(await (await create(n, { kind: "bank", source: "bank", filter: { theme: "smotheredMate" } })).json()).data;
    assert.deepEqual([none.items.length, none.empty], [0, "nothing_matches"]);
  });

  it("puzzles: 10 rated puzzles from the shard server (cold, then warm), a theme switch abandons the previous session", async () => {
    const m = await w.member("puzz");
    await w.persona(m, "puzzles-fresh");
    const before = shards.requests.length;
    const r = await create(m, { kind: "puzzles", source: "nav", theme: "fork" });
    assert.equal(r.res.status, 201, await r.res.clone().text());
    const p = ok(SessionPayload).parse(await r.json()).data;
    assert.equal(p.kind, "puzzles");
    assert.equal(p.items.length, 10);
    assert.equal(p.stream, true);
    assert.equal(p.targetCount, null);
    assert.ok(p.header.rating);
    assert.ok(p.themes && p.themes.length > 0);
    const ratings = p.items.map((i) => i.rating!);
    assert.deepEqual([...ratings].sort((a, b) => a - b), ratings, "warm-up order");
    for (const it of p.items) {
      assert.equal(it.kind, "puzzle");
      assert.equal(it.setup.length, 1);
      assert.ok(it.preview && it.previewAfterAgain);
      assert.ok(it.rating! >= 1412 - 1 && it.rating! <= 1662 + 1, `rating ${it.rating} in the window`);
    }
    const cold = shards.requests.length - before;
    assert.ok(cold > 0, "the first session fetched its shards");
    const pin = await create(m, { kind: "puzzles", source: "picker", theme: "pin" });
    assert.equal(pin.res.status, 201);
    const fork2 = await create(m, { kind: "puzzles", source: "picker", theme: "fork" });
    assert.equal(fork2.res.status, 201);
    const active = await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_sessions WHERE "userId" = ${m.id} AND kind = 'PUZZLES' AND status = 'ACTIVE'`);
    assert.equal(active, 1, "one ACTIVE puzzle session after the theme switches");
    // Warm: the fork shards were not fetched again.
    const forkFetches = shards.requests.filter((x) => x.path.includes("/fork/")).length;
    await create(m, { kind: "puzzles", source: "picker", theme: "fork", count: 3 });
    assert.equal(shards.requests.filter((x) => x.path.includes("/fork/")).length, forkFetches);
  });

  it("puzzles: a sparse window widens and reports it (fixture manifest)", async () => {
    const m = await w.member("widen");
    await w.persona(m, "puzzles-fresh");
    // 2000: the fixture subset stops at band 18 (WP-I widened it to 12–18), so ±100 finds nothing and the window widens.
    await w.db.$executeRaw(Prisma.sql`UPDATE training_profiles SET "puzzleRating" = 2000 WHERE "userId" = ${m.id}`);
    const manifest = PuzzleManifestSchema.parse(JSON.parse(readFileSync(path.join(SHARD_FIXTURES_DIR, "v1", "manifest.json"), "utf8")));
    const t = installTestDeps({ env, clock: WORLD_NOW.getTime() });
    try {
      const out = await openSession(w.viewerOf(m), { kind: "puzzles", source: "nav", theme: "fork", count: 5 }, WORLD_NOW, trainDeps(), { manifest });
      assert.equal(out.payload.items.length, 5);
      assert.ok(out.payload.widened, "the window was widened");
      assert.equal(out.payload.targetCount, 5);
      assert.equal(out.payload.stream, false);
    } finally {
      t.restore();
    }
  });

  it("puzzles: the daily fair use (400) → 429 daily_puzzle_limit; a shard outage → 502 upstream_unavailable", async () => {
    const m = await w.member("fair");
    await w.persona(m, "puzzles-fresh");
    await w.db.$executeRaw(Prisma.sql`INSERT INTO training_days ("userId", day, "puzzlesDone", "updatedAt") VALUES (${m.id}, '2026-11-12', 395, now())
      ON CONFLICT ("userId", day) DO UPDATE SET "puzzlesDone" = 395`);
    const limited = await create(m, { kind: "puzzles", source: "nav", theme: "fork" });
    assert.equal(limited.res.status, 429);
    const err = ErrorEnvelope.parse(await limited.json()).error;
    assert.equal((err.details as { reason?: string }).reason, "daily_puzzle_limit");
    assert.ok(Number(limited.res.headers.get("retry-after")) > 0);

    const down = await startPuzzleShardServer({ port: 0 });
    const downUrl = down.baseUrl;
    await down.close();
    const o = await w.member("outage");
    await w.persona(o, "puzzles-fresh");
    const r = await w.call("sessions", "POST", "/api/train/sessions", o, {
      body: { kind: "puzzles", source: "nav", theme: "pin" },
      headers: { "Idempotency-Key": w.uuid() },
      env: { PUZZLE_SHARD_BASE_URL: downUrl, PUZZLES_VERSION: "v1" },
    });
    assert.equal(r.res.status, 502);
    assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "upstream_unavailable");
  });

  it("the durable session limit: the 31st new session in an hour → 429 with Retry-After, even after TRUNCATE rate_limit_buckets", async () => {
    const m = await w.member("limit");
    await w.persona(m, "bank-member");
    const keys = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`SELECT "itemKey" FROM training_cards WHERE "userId" = ${m.id} ORDER BY id LIMIT 31`)).map((r) => r.itemKey);
    for (let i = 0; i < 30; i++) {
      const r = await create(m, { kind: "bank", source: "solve_one", cardRefs: [keys[i]!] }, { now: new Date(WORLD_NOW.getTime() + i * 1000) });
      assert.equal(r.res.status, 201, `session ${i + 1}`);
    }
    // A reuse is not counted.
    const reuse = await create(m, { kind: "bank", source: "solve_one", cardRefs: [keys[0]!] }, { now: new Date(WORLD_NOW.getTime() + 40_000) });
    assert.equal(reuse.res.status, 200);
    await w.db.$executeRaw(Prisma.sql`TRUNCATE rate_limit_buckets`);
    const over = await create(m, { kind: "bank", source: "solve_one", cardRefs: [keys[30]!] }, { now: new Date(WORLD_NOW.getTime() + 50_000) });
    assert.equal(over.res.status, 429);
    const err = ErrorEnvelope.parse(await over.json()).error;
    assert.equal((err.details as { reason?: string }).reason, "session_limit");
    const retry = Number(over.res.headers.get("retry-after"));
    assert.ok(retry > 3_500 && retry <= 3_600, `Retry-After ${retry}`);
  });

  it("R3 / W3 / W4: resume payload, extend idempotent on `after`, end twice → the same summary, extend after end → 409", async () => {
    const m = await w.member("extend");
    await w.persona(m, "puzzles-fresh");
    const p = ok(SessionPayload).parse(await (await create(m, { kind: "puzzles", source: "nav", theme: "fork" })).json()).data;
    const last = p.items[p.items.length - 1]!.itemId;
    const e1 = await w.call("extend", "POST", `/api/train/sessions/${p.ref}/extend`, m, { params: { ref: p.ref }, body: { after: last }, env });
    assert.equal(e1.res.status, 200, await e1.res.clone().text());
    const x1 = ok(ExtendResult).parse(await e1.json()).data;
    assert.equal(x1.items.length, 10);
    assert.equal(x1.stream, true);
    const ids = new Set(p.items.map((i) => i.puzzleId));
    assert.ok(x1.items.every((i) => !ids.has(i.puzzleId)), "no puzzle twice in a session");
    const e2 = ok(ExtendResult).parse(await (await w.call("extend", "POST", `/api/train/sessions/${p.ref}/extend`, m, { params: { ref: p.ref }, body: { after: last }, env })).json()).data;
    assert.deepEqual(e2.items.map((i) => i.itemId), x1.items.map((i) => i.itemId), "a repeat returns the items already appended");
    const r3 = ok(SessionPayload).parse(await (await w.call("session", "GET", `/api/train/sessions/${p.ref}`, m, { params: { ref: p.ref } })).json()).data;
    assert.equal(r3.items.length, 20);
    const end1 = await w.call("end", "POST", `/api/train/sessions/${p.ref}/end`, m, { params: { ref: p.ref }, body: { reason: "done" } });
    assert.equal(end1.res.status, 200, await end1.res.clone().text());
    const s1 = ok(SessionSummary).parse(await end1.json()).data;
    const s2 = ok(SessionSummary).parse(await (await w.call("end", "POST", `/api/train/sessions/${p.ref}/end`, m, { params: { ref: p.ref }, body: { reason: "done" } })).json()).data;
    assert.deepEqual(s2, s1);
    const viaR3 = ok(SessionSummary).parse(await (await w.call("session", "GET", `/api/train/sessions/${p.ref}`, m, { params: { ref: p.ref }, query: { include: "summary" } })).json()).data;
    assert.deepEqual(viaR3, s1);
    const ended = await w.call("extend", "POST", `/api/train/sessions/${p.ref}/extend`, m, { params: { ref: p.ref }, body: { after: "i20" }, env });
    assert.equal(ended.res.status, 409);
    assert.equal((ErrorEnvelope.parse(await ended.json()).error.details as { reason?: string }).reason, "session_ended");
  });

  it("practice: the same keys, no previews (no FSRS effect)", async () => {
    const m = await w.member("practice");
    await w.persona(m, "bank-member");
    const s = ok(SessionPayload).parse(await (await create(m, { kind: "bank", source: "hub" })).json()).data;
    const pr = await create(m, { kind: "practice", fromSessionRef: s.ref });
    assert.equal(pr.res.status, 201, await pr.res.clone().text());
    const p = ok(SessionPayload).parse(await pr.json()).data;
    assert.equal(p.kind, "practice");
    assert.deepEqual(p.items.map((i) => i.cardRef), s.items.map((i) => i.cardRef));
    assert.ok(p.items.every((i) => i.preview === null && i.previewAfterAgain === null));
  });

  it("a non-member gets 402 on every session route", async () => {
    const m = await w.member("lapsed");
    await w.persona(m, "bank-member");
    const v = nonMember(w, m);
    const r = await create(m, { kind: "bank", source: "hub" }, { viewer: v });
    assert.equal(r.res.status, 402);
    assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "subscription_required");
  });
});
