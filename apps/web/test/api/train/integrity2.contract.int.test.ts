/**
 * Data integrity, round 2 (FIX-2: the second review's probes made regression tests). Two OVERLAPPING W1 flushes (a
 * retry after a lost response, two tabs, two devices) apply an attempt once and never lose a theme row; W6 / A6-off
 * racing an extraction batch of another game holding the same mistake never deadlock; sessionless grades cannot fill
 * past training days nor move the puzzle rating; a pass-2 id is only an item once it was re-queued and a snapshot
 * item's grade only reaches its own card; a puzzle that already has a card is never served again as a new one; one
 * offline batch (pass 1 Again + pass 2) grades a new puzzle card as two online batches do; and an explicit pick the
 * once-a-day rule will not reschedule shows no intervals and queues no copy.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import type { AttemptIn, SessionPayload, TrainItem } from "@repo/contracts/http/train";
import { applyAttempts } from "@/lib/train/attempts.server";
import { removeCard } from "@/lib/train/cards.server";
import { trainDeps, type TrainDeps } from "@/lib/train/db.server";
import { setMomentInBank } from "@/lib/train/links.server";
import { getSessionSummary, openSession } from "@/lib/train/sessions.server";
import { installTestDeps } from "@/test/helpers/route-harness";
import { startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { count, trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const MIN = 60_000;
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("P5 integrity, round 2 (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
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

  async function at<T>(now: Date, fn: () => Promise<T>): Promise<T> {
    const t = installTestDeps({ clock: now.getTime(), env: { ...env } });
    try {
      return await fn();
    } finally {
      t.restore();
    }
  }
  const open = (m: Member, spec: unknown, now = WORLD_NOW) => at(now, () => openSession(w.viewerOf(m), spec as never, now));
  const attempt = (s: SessionPayload | null, item: TrainItem, when: Date, over: Partial<AttemptIn> = {}): AttemptIn => ({
    clientAttemptId: w.uuid(),
    sessionRef: s ? s.ref : null,
    itemId: s ? item.itemId : null,
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
  const missed = { solved: false, firstTry: false, solutionShown: true, grade: "again", suggestedGrade: "again" } as const;
  const post = (m: Member, list: AttemptIn[], now: Date, deps?: TrainDeps) => at(now, async () => (await applyAttempts(w.viewerOf(m), list, now, deps)).result);

  /** Deps whose transaction pauses `ms` after its locked read (the 2nd statement: the lock, then the read), holding its locks. */
  function slowDeps(ms: number): TrainDeps {
    const base = trainDeps();
    return {
      db: base.db,
      tx: (fn) =>
        base.tx(async (db) => {
          let n = 0;
          const p = new Proxy(db, {
            get(t, k, r) {
              const v = Reflect.get(t, k, r);
              if (k !== "$queryRaw") return typeof v === "function" ? v.bind(t) : v;
              return async (...a: unknown[]) => {
                const o = await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
                n += 1;
                if (n === 2) await sleep(ms);
                return o;
              };
            },
          });
          return fn(p as typeof db);
        }),
    };
  }
  const stateOf = async (m: Member, ref: string) => ({
    profile: (await w.db.$queryRaw<{ n: number; r: number }[]>(Prisma.sql`SELECT "puzzleAttempts" AS n, "puzzleRating" AS r FROM training_profiles WHERE "userId" = ${m.id}`))[0]!,
    pd: (await w.db.$queryRaw<{ pd: number }[]>(Prisma.sql`SELECT COALESCE(sum("puzzlesDone"), 0)::int AS pd FROM training_days WHERE "userId" = ${m.id}`))[0]!.pd,
    total: (await w.db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT total FROM training_sessions WHERE "referenceId" = ${ref}`))[0]!.total,
    rows: await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${m.id}`),
  });

  for (const sameId of [true, false]) {
    it(`two OVERLAPPING flushes of one puzzle item (${sameId ? "the same clientAttemptId: a retry after a lost response" : "fresh ids: two tabs"}) apply it once`, async () => {
      const m = await w.member(sameId ? "overlapsame" : "overlapfresh");
      await w.persona(m, "puzzles-fresh");
      const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
      const t0 = new Date(WORLD_NOW.getTime() + MIN);
      assert.equal((await post(m, [attempt(s, s.items[0]!, t0)], t0)).results[0]!.status, "ok");
      const before0 = await stateOf(m, s.ref);
      const t1 = new Date(WORLD_NOW.getTime() + 2 * MIN);
      const a = attempt(s, s.items[1]!, t1);
      const b = sameId ? a : { ...a, clientAttemptId: w.uuid() };
      const [x, y] = await Promise.all([
        post(m, [a], t1, slowDeps(600)),
        (async () => {
          await sleep(150);
          return post(m, [b], t1);
        })(),
      ]);
      const statuses = [x.results[0]!.status, y.results[0]!.status].sort();
      assert.deepEqual(statuses, sameId ? ["duplicate", "ok"] : ["conflict", "ok"]);
      const after1 = await stateOf(m, s.ref);
      assert.equal(after1.profile.n - before0.profile.n, 1, "puzzleAttempts moved once");
      assert.equal(after1.pd - before0.pd, 1, "puzzlesDone moved once");
      assert.equal(after1.total - before0.total, 1, "the session total moved once");
      assert.equal(after1.rows - before0.rows, 1, "one attempt row");
    });
  }

  it("a theme row created by an overlapping flush is never overwritten (attempts and EWMA keep both grades)", async () => {
    const m = await w.member("overlaptheme");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    // Two items of one theme the member has no row for yet (a fork session's items are forks).
    const theme = s.items[1]!.theme.key;
    assert.equal(s.items[2]!.theme.key, theme);
    await w.db.$executeRaw(Prisma.sql`DELETE FROM theme_mastery WHERE "userId" = ${m.id} AND theme = ${theme}`);
    const t1 = new Date(WORLD_NOW.getTime() + 2 * MIN);
    const [x, y] = await Promise.all([
      post(m, [attempt(s, s.items[1]!, t1)], t1, slowDeps(600)),
      (async () => {
        await sleep(150);
        return post(m, [attempt(s, s.items[2]!, t1)], t1);
      })(),
    ]);
    assert.deepEqual([x.results[0]!.status, y.results[0]!.status], ["ok", "ok"]);
    const row = await w.db.$queryRaw<{ attempts: number; firstTry: number }[]>(Prisma.sql`SELECT attempts, "firstTry" FROM theme_mastery WHERE "userId" = ${m.id} AND theme = ${theme}`);
    assert.equal(row[0]!.attempts, 2, "both attempts of the new theme counted");
    assert.equal(row[0]!.firstTry, 2);
  });

  for (const via of ["W6 remove", "A6 off"] as const) {
    it(`${via} racing an extraction batch of ANOTHER game that holds the same mistake: no deadlock (J1's lock order)`, async () => {
      const m = await w.member(via === "W6 remove" ? "dlw6" : "dla6");
      await w.persona(m, "bank-member");
      const row = (
        await w.db.$queryRaw<{ mid: bigint; key: string; gx: bigint; gref: string; ply: number }[]>(Prisma.sql`
          SELECT m.id AS mid, c."itemKey" AS key, mo."gameId" AS gx, g."referenceId" AS gref, mo.ply
            FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" JOIN mistake_occurrences mo ON mo."mistakeId" = m.id
            JOIN games g ON g.id = mo."gameId"
           WHERE c."userId" = ${m.id} AND c.deck = 'BANK' ORDER BY c.id LIMIT 1`)
      )[0]!;
      const gy = (
        await w.db.$queryRaw<{ gid: bigint }[]>(Prisma.sql`SELECT pr."gameId" AS gid FROM player_reviews pr JOIN game_players gp
          ON gp."gameId" = pr."gameId" AND gp.color = pr.color WHERE gp."userId" = ${m.id} AND pr."gameId" <> ${row.gx} LIMIT 1`)
      )[0]!.gid;
      await w.db.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId") VALUES (${gy}, 77, ${row.mid}) ON CONFLICT DO NOTHING`);
      // J1 of game Y in bankStatements.ts order: L (Y's review rows) → 1 (the mistake) → 4 (the card), paused between 1 and 4.
      const j1 = w.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT count(*)::int FROM (SELECT 1 FROM player_reviews WHERE "gameId" = ${gy} FOR UPDATE) l`);
          await tx.$executeRaw(Prisma.sql`UPDATE mistakes SET "updatedAt" = now() WHERE id = ${row.mid}`);
          await sleep(400);
          await tx.$executeRaw(Prisma.sql`UPDATE training_cards SET "updatedAt" = now() WHERE "mistakeId" = ${row.mid}`);
          return "j1 ok";
        },
        { timeout: 10_000 },
      );
      await sleep(120);
      const t = installTestDeps({ clock: WORLD_NOW.getTime(), env: {} });
      const web = (via === "W6 remove" ? removeCard(w.viewerOf(m), row.key, WORLD_NOW) : setMomentInBank(w.viewerOf(m), row.gref, row.ply, false, WORLD_NOW)).then(
        () => "web ok",
        (e: unknown) => `web failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`,
      );
      const out = await Promise.all([j1.catch((e: unknown) => `j1 failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`), web]);
      t.restore();
      assert.deepEqual(out, ["j1 ok", "web ok"], "no deadlock");
      assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${m.id} AND "itemKey" = ${row.key}`), 0, "the card is gone");
    });
  }

  it("sessionless grades are dated by the server: seven backdated grades of one card cannot build a streak or past days", async () => {
    const m = await w.member("sessionless");
    await w.persona(m, "bank-member");
    await w.db.$executeRaw(Prisma.sql`UPDATE training_profiles SET "dayStreak" = 0, "lastActiveDay" = '2026-10-20' WHERE "userId" = ${m.id}`);
    await w.db.$executeRaw(Prisma.sql`DELETE FROM training_days WHERE "userId" = ${m.id}`);
    await w.db.$executeRaw(Prisma.sql`DELETE FROM training_attempts WHERE "userId" = ${m.id}`);
    await w.db.$executeRaw(Prisma.sql`UPDATE training_cards SET "lastReview" = '2026-10-20T10:00:00Z' WHERE "userId" = ${m.id}`);
    const card = (await w.db.$queryRaw<{ key: string; reps: number }[]>(Prisma.sql`SELECT "itemKey" AS key, reps FROM training_cards WHERE "userId" = ${m.id} AND deck = 'BANK' ORDER BY id LIMIT 1`))[0]!;
    let reps = Number(card.reps);
    const statuses: string[] = [];
    for (let d = 6; d >= 0; d--) {
      const when = new Date(WORLD_NOW.getTime() - d * DAY);
      const item = { cardRef: card.key, puzzleId: null, kind: "mistake", cardReps: reps } as unknown as TrainItem;
      const r = (await post(m, [attempt(null, item, when)], WORLD_NOW)).results[0]!;
      statuses.push(r.status);
      if (r.status === "ok") reps = r.card!.reps;
    }
    assert.equal(statuses[0], "ok", "the first is applied (at the server's clock)");
    assert.ok(statuses.slice(1).every((s) => s === "conflict"), `the card was graded today: the rest reschedule nothing (${statuses.join(",")})`);
    const p = (await w.db.$queryRaw<{ ds: number }[]>(Prisma.sql`SELECT "dayStreak" AS ds FROM training_profiles WHERE "userId" = ${m.id}`))[0]!;
    assert.equal(p.ds, 1);
    const days = await w.db.$queryRaw<{ day: string }[]>(Prisma.sql`SELECT to_char(day, 'YYYY-MM-DD') AS day FROM training_days WHERE "userId" = ${m.id}`);
    assert.deepEqual(days.map((d) => d.day), ["2026-11-12"], "no past training day was written");
    const at1 = (await w.db.$queryRaw<{ at: Date }[]>(Prisma.sql`SELECT "reviewedAt" AS at FROM training_attempts WHERE "userId" = ${m.id}`))[0]!.at;
    assert.equal(new Date(`${at1.toISOString().slice(0, 23)}Z`).getTime(), WORLD_NOW.getTime());
  });

  it("a sessionless grade of a PUZZLE card never moves the puzzle rating", async () => {
    const m = await w.member("sessionlesspz");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    const t1 = new Date(WORLD_NOW.getTime() + MIN);
    // A missed puzzle becomes a PUZZLE card (D-6).
    const made = (await post(m, [attempt(s, s.items[0]!, t1, missed)], t1)).results[0]!;
    assert.equal(made.status, "ok");
    const before0 = (await w.db.$queryRaw<{ n: number; r: number }[]>(Prisma.sql`SELECT "puzzleAttempts" AS n, "puzzleRating" AS r FROM training_profiles WHERE "userId" = ${m.id}`))[0]!;
    const t2 = new Date(WORLD_NOW.getTime() + 30 * MIN);
    const item = { ...s.items[0]!, cardRef: made.card!.ref, cardReps: made.card!.reps };
    const r = (await post(m, [attempt(null, item, t2)], t2)).results[0]!;
    assert.equal(r.status, "ok");
    assert.equal(r.rating, undefined, "no rating for a sessionless grade");
    const after0 = (await w.db.$queryRaw<{ n: number; r: number }[]>(Prisma.sql`SELECT "puzzleAttempts" AS n, "puzzleRating" AS r FROM training_profiles WHERE "userId" = ${m.id}`))[0]!;
    assert.deepEqual(after0, before0);
  });

  it("a pass-2 id is not an item until the item was re-queued; a snapshot item's grade reaches only its own card", async () => {
    const m = await w.member("pass2forge");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    const [i0, i1] = [s.items[0]!, s.items[1]!];
    const t1 = new Date(WORLD_NOW.getTime() + MIN);
    // Hard with the solution shown: no re-queue (only Again re-queues).
    assert.equal((await post(m, [attempt(s, i0, t1, { ...missed, grade: "hard" })], t1)).results[0]!.status, "ok");
    const t2 = new Date(WORLD_NOW.getTime() + 2 * MIN);
    const forged = (await post(m, [attempt(s, { ...i0, itemId: `${i0.itemId}b` }, t2)], t2)).results[0]!;
    assert.deepEqual(forged, { clientAttemptId: forged.clientAttemptId, status: "rejected", reason: "not_found" });
    const sum = await at(t2, () => getSessionSummary(w.viewerOf(m), s.ref, t2));
    assert.equal(sum.stats.solved, 0, "the summary still says 0 solved");
    // i0's miss made the card p_<i0>; i1 is a snapshot item: naming i0's card for it is not its item.
    const cardOf0 = `p_${i0.puzzleId}`;
    const t3 = new Date(WORLD_NOW.getTime() + 3 * MIN);
    const cross = (await post(m, [attempt(s, { ...i1, cardRef: cardOf0, puzzleId: null, cardReps: 1 }, t3)], t3)).results[0]!;
    assert.equal(cross.status, "rejected");
    // An Again re-queues the copy; then its pass-2 id is an item.
    const t4 = new Date(WORLD_NOW.getTime() + 4 * MIN);
    assert.equal((await post(m, [attempt(s, i1, t4, missed)], t4)).results[0]!.card?.requeued, true);
    const t5 = new Date(WORLD_NOW.getTime() + 15 * MIN);
    assert.equal((await post(m, [attempt(s, { ...i1, itemId: `${i1.itemId}b`, pass: 2 }, t5)], t5)).results[0]!.status, "ok");
  });

  it("a puzzle that already has a PUZZLE card is never served again as a new puzzle (its 90 days passed, or it is not due)", async () => {
    const m = await w.member("cardedpuzzle");
    await w.persona(m, "puzzles-fresh");
    const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
    const t1 = new Date(WORLD_NOW.getTime() + MIN);
    const made = (await post(m, [attempt(s, s.items[0]!, t1, missed)], t1)).results[0]!;
    assert.equal(made.status, "ok");
    const pid = s.items[0]!.puzzleId!;
    // The card's interval is long and its attempt is older than the 90-day exclusion: only the card remembers it.
    await w.db.$executeRaw(Prisma.sql`UPDATE training_cards SET due = '2027-06-01', state = 'REVIEW', reps = 3 WHERE "userId" = ${m.id} AND "itemKey" = ${`p_${pid}`}`);
    await w.db.$executeRaw(Prisma.sql`UPDATE training_attempts SET "reviewedAt" = '2026-07-01' WHERE "userId" = ${m.id} AND "puzzleId" = ${pid}`);
    await w.db.$executeRaw(Prisma.sql`UPDATE training_sessions SET status = 'ABANDONED', "endedAt" = now() WHERE "userId" = ${m.id}`);
    for (let k = 0; k < 4; k++) {
      const later = new Date(WORLD_NOW.getTime() + (10 + k) * MIN);
      const again = (await open(m, { kind: "puzzles", source: "nav", theme: "fork", count: 20 }, later)).payload;
      assert.ok(!again.items.some((it) => it.puzzleId === pid && it.cardRef === null), `round ${k}: never as a new puzzle`);
      await w.db.$executeRaw(Prisma.sql`UPDATE training_sessions SET status = 'ABANDONED', "endedAt" = now() WHERE "referenceId" = ${again.ref}`);
    }
  });

  it("one offline batch (pass 1 Again + its pass 2) grades a new puzzle card exactly as two online batches do", async () => {
    const results: { state: string; due: string; reps: number }[] = [];
    for (const mode of ["one batch", "two batches"] as const) {
      const m = await w.member(mode === "one batch" ? "offline1" : "offline2");
      await w.persona(m, "puzzles-fresh");
      const s = (await open(m, { kind: "puzzles", source: "nav", theme: "fork" })).payload;
      const item = s.items[0]!;
      const t1 = new Date(WORLD_NOW.getTime() + MIN);
      const t2 = new Date(WORLD_NOW.getTime() + 12 * MIN);
      const p1 = attempt(s, item, t1, missed);
      const p2 = attempt(s, { ...item, itemId: `${item.itemId}b`, pass: 2 }, t2);
      if (mode === "one batch") {
        const r = await post(m, [p1, p2], t2);
        assert.deepEqual(r.results.map((x) => x.status), ["ok", "ok"]);
        assert.equal(r.results[1]!.card?.scheduled, true, "the pass-2 grade is applied");
      } else {
        assert.equal((await post(m, [p1], t1)).results[0]!.status, "ok");
        assert.equal((await post(m, [p2], t2)).results[0]!.card?.scheduled, true);
      }
      const c = (await w.db.$queryRaw<{ state: string; due: Date; reps: number }[]>(Prisma.sql`SELECT state::text AS state, due, reps FROM training_cards WHERE "userId" = ${m.id} AND "itemKey" = ${`p_${item.puzzleId}`}`))[0]!;
      results.push({ state: c.state, due: c.due.toISOString(), reps: c.reps });
    }
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0]!.state, "REVIEW");
    assert.equal(results[0]!.reps, 2);
  });

  it("an explicit pick the once-a-day rule will not reschedule shows no intervals, and its Again queues no copy (client and W1 agree)", async () => {
    const m = await w.member("onceaday");
    await w.persona(m, "bank-member");
    // A REVIEW card reviewed two hours ago and due in ten days.
    const card = (await w.db.$queryRaw<{ key: string }[]>(Prisma.sql`SELECT "itemKey" AS key FROM training_cards WHERE "userId" = ${m.id} AND deck = 'BANK' ORDER BY id LIMIT 1`))[0]!;
    await w.db.$executeRaw(Prisma.sql`UPDATE training_cards SET state = 'REVIEW', reps = 4, stability = 12, difficulty = 5, "lastReview" = ${new Date(WORLD_NOW.getTime() - 2 * 3_600_000)},
      due = ${new Date(WORLD_NOW.getTime() + 10 * DAY)}, "suspendedUntil" = NULL WHERE "userId" = ${m.id} AND "itemKey" = ${card.key}`);
    const s = (await open(m, { kind: "bank", source: "bank_row", cardRefs: [card.key] })).payload;
    const item = s.items.find((it) => it.cardRef === card.key)!;
    assert.equal(item.preview, null, "no interval: grading it reschedules nothing today");
    assert.equal(item.previewAfterAgain, null);
    const t1 = new Date(WORLD_NOW.getTime() + MIN);
    const r = (await post(m, [attempt(s, item, t1, missed)], t1)).results[0]!;
    assert.equal(r.status, "ok");
    assert.equal(r.card?.scheduled, false);
    assert.equal(r.card?.requeued, false, "no pass-2 copy for a grade that schedules nothing");
    const items = (await w.db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT jsonb_array_length(items->'items') AS n FROM training_sessions WHERE "referenceId" = ${s.ref}`))[0]!.n;
    assert.equal(items, s.items.length);
  });
});
