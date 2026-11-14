/**
 * Data integrity under concurrency and replays (FIX-1, the round-1 review's probes A–G, made regression tests): a puzzle
 * item graded in two tabs or replayed with fresh clientAttemptIds is applied once; two creates of one spec at once give
 * one ACTIVE session; a member past the hourly limit gets 429 before any build work; a skip that commits while W3
 * extends survives; A6 racing an extraction batch leaves no card for an opted-out moment; a time-zone change mid-day
 * keeps today's row (the used cap stays used); a streaming session stops at SESSION_ITEMS_MAX and stays readable; and
 * concurrent reports never pass 20 a day nor duplicate a target.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { SESSION_ITEMS_MAX } from "@repo/chess-training/constants";
import { TRAIN_SESSION_HOURLY, type AttemptIn, type SessionPayload, type TrainItem } from "@repo/contracts/http/train";
import { ApiError } from "@/lib/api/api-error";
import { applyAttempts } from "@/lib/train/attempts.server";
import { capOf } from "@/lib/train/badges.server";
import { loadTrainState } from "@/lib/train/day.server";
import { trainDeps, type TrainDeps } from "@/lib/train/db.server";
import { setMomentInBank } from "@/lib/train/links.server";
import { createReport } from "@/lib/reports/reports.server";
import { extendSession, getSession, openSession } from "@/lib/train/sessions.server";
import { installTestDeps } from "@/test/helpers/route-harness";
import { startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { count, trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const MIN = 60_000;

describe("P5 integrity (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
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

  /** Runs `fn` with the request clock and the shard env of a route. */
  async function at<T>(now: Date, fn: () => Promise<T>): Promise<T> {
    const t = installTestDeps({ clock: now.getTime(), env: { ...env } });
    try {
      return await fn();
    } finally {
      t.restore();
    }
  }
  const open = (m: Member, spec: unknown, now = WORLD_NOW) => at(now, () => openSession(w.viewerOf(m), spec as never, now));
  const attempt = (s: SessionPayload, item: TrainItem, when: Date, over: Partial<AttemptIn> = {}): AttemptIn => ({
    clientAttemptId: w.uuid(),
    sessionRef: s.ref,
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
    reviewedAt: when.toISOString(),
    ...over,
  });
  const post = (m: Member, list: AttemptIn[], now: Date) => at(now, async () => (await applyAttempts(w.viewerOf(m), list, now)).result);
  const profileOf = async (m: Member) =>
    (await w.db.$queryRaw<{ n: number; r: number }[]>(Prisma.sql`SELECT "puzzleAttempts" AS n, "puzzleRating" AS r FROM training_profiles WHERE "userId" = ${m.id}`))[0]!;

  it("A: one puzzle item graded in two tabs, and replays with fresh clientAttemptIds, are applied once", async () => {
    const m = await w.member("twotabs");
    await w.persona(m, "puzzles-fresh");
    const tab1 = await open(m, { kind: "puzzles", source: "nav", theme: "fork" });
    const tab2 = await open(m, { kind: "puzzles", source: "nav", theme: "fork" }, new Date(WORLD_NOW.getTime() + 1000));
    assert.equal(tab2.payload.ref, tab1.payload.ref, "the second tab resumes the same session");
    const item = tab1.payload.items[0]!;
    const r1 = await post(m, [attempt(tab1.payload, item, new Date(WORLD_NOW.getTime() + MIN))], new Date(WORLD_NOW.getTime() + MIN));
    assert.equal(r1.results[0]!.status, "ok");
    assert.ok(r1.rating, "the batch's whole rating state");
    const after1 = await profileOf(m);
    assert.equal(after1.n, 1);
    assert.ok(Math.abs(r1.rating!.value - after1.r) < 1e-3, "the stored rating (real)");
    const r2 = await post(m, [attempt(tab2.payload, tab2.payload.items[0]!, new Date(WORLD_NOW.getTime() + 2 * MIN))], new Date(WORLD_NOW.getTime() + 2 * MIN));
    assert.equal(r2.results[0]!.status, "conflict");
    const replays = Array.from({ length: 5 }, (_, i) => attempt(tab1.payload, item, new Date(WORLD_NOW.getTime() + (3 + i) * MIN)));
    const r3 = await post(m, replays, new Date(WORLD_NOW.getTime() + 9 * MIN));
    assert.deepEqual(r3.results.map((r) => r.status), ["conflict", "conflict", "conflict", "conflict", "conflict"]);
    // An invented item id is not a new item.
    const fake = await post(m, [attempt(tab1.payload, { ...item, itemId: "i99" }, new Date(WORLD_NOW.getTime() + 10 * MIN))], new Date(WORLD_NOW.getTime() + 10 * MIN));
    assert.equal(fake.results[0]!.status, "rejected");
    assert.deepEqual(await profileOf(m), after1, "the rating moved once");
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${m.id} AND "itemId" = ${item.itemId}`), 1);
    const day = await w.db.$queryRaw<{ pd: number }[]>(Prisma.sql`SELECT "puzzlesDone" AS pd FROM training_days WHERE "userId" = ${m.id}`);
    assert.equal(day[0]!.pd, 1);
    const sess = await w.db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT total FROM training_sessions WHERE "referenceId" = ${tab1.payload.ref}`);
    assert.equal(sess[0]!.total, 1);
  });

  it("C: two creates of one spec at once give one ACTIVE session (the second reuses it)", async () => {
    for (let i = 0; i < 4; i++) {
      const m = await w.member(`race${i}`);
      await w.persona(m, "bank-member");
      const [a, b] = await Promise.all([open(m, { kind: "bank", source: "hub" }), open(m, { kind: "bank", source: "hub" })]);
      assert.equal(a.payload.ref, b.payload.ref, `round ${i}: one session`);
      assert.equal(Number(a.created) + Number(b.created), 1);
      assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_sessions WHERE "userId" = ${m.id} AND status = 'ACTIVE' AND kind = 'BANK'`), 1);
    }
  });

  it("the hourly session limit answers 429 before any build work (no shard read), also under concurrency", async () => {
    const m = await w.member("limit");
    await w.persona(m, "puzzles-fresh");
    await w.db.$executeRaw(Prisma.sql`INSERT INTO training_sessions ("referenceId", "userId", kind, status, source, "filterKey", size, mix,
        "countsTowardCap", items, day, "startedAt")
      SELECT 'lim' || ${m.id}::text || 'x' || g, ${m.id}, 'BANK', 'COMPLETED', 'hub', 'k' || g, 0, false, false, '{"v":1,"items":[]}'::jsonb, '2026-11-12'::date,
        (${WORLD_NOW.toISOString()}::timestamptz AT TIME ZONE 'UTC') - interval '10 minutes'
      FROM generate_series(1, ${TRAIN_SESSION_HOURLY.limit - 1}) g`);
    await fetch(`${shards.origin}/__requests`, { method: "DELETE" });
    const both = await Promise.allSettled([
      open(m, { kind: "bank", source: "hub" }),
      open(m, { kind: "bank", source: "hub", filter: { theme: "fork" } }),
    ]);
    assert.equal(both.filter((r) => r.status === "fulfilled").length, 1, "the 30th fits, the 31st does not");
    const refused = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(refused.reason instanceof ApiError && refused.reason.code === "rate_limited");
    await assert.rejects(open(m, { kind: "puzzles", source: "nav", theme: "fork" }), (e) => e instanceof ApiError && e.code === "rate_limited");
    const seen = (await (await fetch(`${shards.origin}/__requests`)).json()) as { requests: unknown[] };
    assert.equal(seen.requests.length, 0, "no shard was read for a refused create");
  });

  it("D: a skip that commits while W3 extends keeps its flag (the extend appends, never rewrites)", async () => {
    const m = await w.member("skipext");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    const base = trainDeps();
    let injected = false;
    const db = new Proxy(base.db, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k !== "$queryRaw") return typeof v === "function" ? v.bind(t) : v;
        return async (sql: Prisma.Sql, ...rest: unknown[]) => {
          const out = await (v as (...a: unknown[]) => Promise<unknown>).call(t, sql, ...rest);
          if (!injected && /FROM training_sessions WHERE "referenceId"/.test(sql.sql) && !/FOR UPDATE/.test(sql.sql)) {
            injected = true;
            await w.db.$executeRaw(Prisma.sql`UPDATE training_sessions SET items = jsonb_set(items, '{items,0,skipped}', 'true'::jsonb)
              WHERE "referenceId" = ${s.ref}`);
          }
          return out;
        };
      },
    }) as TrainDeps["db"];
    const x = await at(WORLD_NOW, () => extendSession(w.viewerOf(m), s.ref, s.items[s.items.length - 1]!.itemId, new Date(WORLD_NOW.getTime() + MIN), { db, tx: base.tx }));
    assert.ok(injected);
    assert.equal(x.items.length, 10);
    const rows = await w.db.$queryRaw<{ skipped: boolean | null; n: number }[]>(Prisma.sql`SELECT (items->'items'->0->>'skipped')::boolean AS skipped,
      jsonb_array_length(items->'items') AS n FROM training_sessions WHERE "referenceId" = ${s.ref}`);
    assert.deepEqual(rows[0], { skipped: true, n: 20 });
  });

  it("E: A6 opting out while an extraction batch commits leaves no card for the opted-out moment", async () => {
    const m = await w.member("a6race");
    const rep = await w.persona(m, "bank-member");
    const ref = rep.gameRefs.GAME!;
    const mom = (await w.db.$queryRaw<{ ply: number; mistakeId: bigint; gameId: bigint; cardId: bigint }[]>(Prisma.sql`
      SELECT mo.ply, m.id AS "mistakeId", g.id AS "gameId", c.id AS "cardId"
        FROM games g JOIN mistake_occurrences mo ON mo."gameId" = g.id JOIN mistakes m ON m.id = mo."mistakeId" AND m."userId" = ${m.id}
        JOIN training_cards c ON c."mistakeId" = m.id WHERE g."referenceId" = ${ref} ORDER BY mo.ply LIMIT 1`))[0]!;
    const card = (await w.db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT "userId", kind::text AS kind, "itemKey", "mistakeId", theme,
      phase::text AS phase, due FROM training_cards WHERE id = ${mom.cardId}`))[0]!;
    await w.db.$executeRaw(Prisma.sql`DELETE FROM mistake_occurrences WHERE "gameId" = ${mom.gameId}`);
    await w.db.$executeRaw(Prisma.sql`DELETE FROM training_cards WHERE id = ${mom.cardId}`);
    const base = trainDeps();
    let injected = false;
    const db = new Proxy(base.db, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (k !== "$queryRaw") return typeof v === "function" ? v.bind(t) : v;
        return async (sql: Prisma.Sql, ...rest: unknown[]) => {
          const out = await (v as (...a: unknown[]) => Promise<unknown>).call(t, sql, ...rest);
          if (!injected && /"isError"/.test(sql.sql)) {
            injected = true;
            // The extraction batch commits now: the occurrence and the card (the opt-out is not recorded yet).
            await w.db.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${mom.gameId}, ${mom.ply}::smallint, ${mom.mistakeId})`);
            await w.db.$executeRaw(Prisma.sql`INSERT INTO training_cards ("userId", deck, kind, "itemKey", "mistakeId", theme, phase, due, state, "createdAt", "updatedAt")
              VALUES (${card.userId as bigint}, 'BANK', ${card.kind as string}::"TrainingItemKind", ${card.itemKey as string}, ${card.mistakeId as bigint},
                ${card.theme as string}, ${card.phase as string}::"GamePhase", ${card.due as Date}, 'NEW', now(), now())`);
          }
          return out;
        };
      },
    }) as TrainDeps["db"];
    const res = await at(WORLD_NOW, () => setMomentInBank(w.viewerOf(m), ref, mom.ply, false, WORLD_NOW, { db, tx: base.tx }));
    assert.ok(injected);
    assert.deepEqual(res, { ply: mom.ply, inBank: false, card: null });
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM player_reviews WHERE "gameId" = ${mom.gameId} AND progress->'bankOptOut' @> to_jsonb(${mom.ply}::int)`), 1);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${m.id} AND "mistakeId" = ${mom.mistakeId}`), 0, "no live card for the opted-out moment");
  });

  it("F: a time-zone change mid-day keeps today's row: the used cap stays used, the day key does not move", async () => {
    const m = await w.member("tzswitch");
    await w.persona(m, "bank-caughtup");
    // Today's row records the zone it was opened in (a real day's first write does this).
    await w.db.$executeRaw(Prisma.sql`UPDATE training_days SET "timeZone" = 'UTC', "dayStartHour" = 4 WHERE "userId" = ${m.id} AND day = '2026-11-12'::date`);
    const s0 = await loadTrainState(trainDeps().db, w.viewerOf(m), WORLD_NOW);
    const c0 = capOf(s0.due, s0.profile, s0.counters);
    await w.db.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = 'Pacific/Kiritimati' WHERE id = ${m.id}`);
    const s1 = await loadTrainState(trainDeps().db, w.viewerOf({ ...m, timeZone: "Pacific/Kiritimati" }), WORLD_NOW);
    const c1 = capOf(s1.due, s1.profile, s1.counters);
    assert.equal(s0.clock.today, "2026-11-12");
    assert.equal(s1.clock.today, "2026-11-12", "today stays the day it began as");
    assert.equal(s1.counters.bankReviewed, s0.counters.bankReviewed);
    assert.equal(c1.capRemaining, c0.capRemaining);
    assert.equal(c1.capRemaining, 0);
    // After the UTC day ends (04:00 UTC), Kiritimati's days follow.
    const later = new Date("2026-11-13T05:00:00Z");
    const s2 = await loadTrainState(trainDeps().db, w.viewerOf({ ...m, timeZone: "Pacific/Kiritimati" }), later);
    assert.equal(s2.clock.today, "2026-11-13");
  });

  it("G: a puzzle stream stops at SESSION_ITEMS_MAX; an Again on the full list queues no copy; the session stays readable", async () => {
    const m = await w.member("stream40");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    let ids = s.items.map((i) => i.itemId);
    let stream = true;
    for (let k = 0; k < 5 && stream; k++) {
      const x = await at(WORLD_NOW, () => extendSession(w.viewerOf(m), s.ref, ids[ids.length - 1]!, new Date(WORLD_NOW.getTime() + (k + 1) * MIN)));
      ids = [...ids, ...x.items.map((i) => i.itemId)];
      stream = x.stream;
    }
    assert.equal(ids.length, SESSION_ITEMS_MAX);
    assert.equal(stream, false, "the stream says it ended");
    const more = await at(WORLD_NOW, () => extendSession(w.viewerOf(m), s.ref, ids[ids.length - 1]!, new Date(WORLD_NOW.getTime() + 8 * MIN)));
    assert.deepEqual(more, { items: [], stream: false });
    const full = await at(WORLD_NOW, () => getSession(w.viewerOf(m), s.ref, new Date(WORLD_NOW.getTime() + 9 * MIN)));
    const it30 = full.items[30]!;
    const again = await post(m, [attempt(full, it30, new Date(WORLD_NOW.getTime() + 10 * MIN), { grade: "again", suggestedGrade: "again", solved: false, firstTry: false, solutionShown: true })], new Date(WORLD_NOW.getTime() + 10 * MIN));
    assert.equal(again.results[0]!.status, "ok");
    assert.notEqual(again.results[0]!.card?.requeued, true);
    const after = await at(WORLD_NOW, () => getSession(w.viewerOf(m), s.ref, new Date(WORLD_NOW.getTime() + 11 * MIN)));
    assert.equal(after.items.length, SESSION_ITEMS_MAX, "still readable");
    assert.equal(after.empty, null);
    const next = await post(m, [attempt(full, full.items[31]!, new Date(WORLD_NOW.getTime() + 12 * MIN))], new Date(WORLD_NOW.getTime() + 12 * MIN));
    assert.equal(next.results[0]!.status, "ok", "the next grade is applied, not dropped");
  });

  it("reports: 25 concurrent POSTs never pass 20 a day, and the same target twice at once is filed once", async () => {
    const m = await w.member("reportrace");
    await w.persona(m, "bank-member");
    const mistakes = await w.db.$queryRaw<{ ref: string; fen: string }[]>(Prisma.sql`SELECT "referenceId" AS ref, fen FROM mistakes WHERE "userId" = ${m.id} ORDER BY id LIMIT 24`);
    assert.ok(mistakes.length >= 22);
    const send = (i: number) =>
      at(WORLD_NOW, () => createReport(w.viewerOf(m), { targetType: "mistake", targetRef: mistakes[i % mistakes.length]!.ref, reason: "other", fen: mistakes[i % mistakes.length]!.fen }, WORLD_NOW)).catch((e: unknown) => e);
    const same = await Promise.all([send(0), send(0), send(0)]);
    assert.equal(same.filter((r) => !(r instanceof Error) && (r as { status: number }).status === 201).length, 1);
    await Promise.all(Array.from({ length: 25 }, (_, i) => send(i + 1)));
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM reports WHERE "reporterId" = ${m.id}`), 20);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM (SELECT "targetRef" FROM reports WHERE "reporterId" = ${m.id} GROUP BY 1 HAVING count(*) > 1) d`), 0);
  });
});
