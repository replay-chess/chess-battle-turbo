/**
 * W1 `POST /api/train/attempts` on a real Postgres (phase-05 plan §12.2 "W1 attempts"): statuses (ok, duplicate,
 * conflict, rejected too_old / not_found / bad_item), the cap counters (first grade of a BANK card today, counting
 * sessions only; NEW cards), the once-a-day rule and practice, the Again re-queue, offline replay in `reviewedAt` order
 * with the clamp, the plan bit, the day streak once a day, theme mastery and its milestone once, Glicko for puzzles and
 * PUZZLE cards only for a miss (D-6), the resume index, a 50-item batch's time, and the concurrency case (api-perf
 * AP-27): J1-shaped batches committing in a loop for the same member while 200 W1 batches run → W1 p95 < 300 ms, no
 * deadlock, no lost theme_mastery update.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { AttemptsResult, SessionPayload, TrainToday, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { applyAttempts } from "@/lib/train/attempts.server";
import { startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { count, nonMember, trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
const DAY = 86_400_000;

type Outcome = "good" | "hint" | "wrong" | "shown";

describe("P5 W1 attempts (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
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

  const create = async (m: Member, body: unknown, now = WORLD_NOW) => {
    const r = await w.call("sessions", "POST", "/api/train/sessions", m, { body, headers: { "Idempotency-Key": w.uuid() }, now, env });
    assert.ok(r.res.status === 201 || r.res.status === 200, await r.res.clone().text());
    return ok(SessionPayload).parse(await r.json()).data;
  };

  /** An attempt for an item, as the runner builds it (the wrong move is a legal-looking move that is not the answer). */
  function attempt(session: SessionPayload | null, item: TrainItem, outcome: Outcome, at: Date, grade?: AttemptIn["grade"]): AttemptIn {
    const wrong = outcome === "wrong" || outcome === "shown" ? ["a2a3"].filter((u) => u !== item.solution[0] && !item.accept.includes(u)) : [];
    const suggested = outcome === "good" ? "good" : outcome === "hint" ? "hard" : "again";
    return {
      clientAttemptId: w.uuid(),
      sessionRef: session?.ref ?? null,
      itemId: item.itemId,
      cardRef: item.cardRef,
      puzzleId: item.puzzleId,
      kind: item.kind,
      solved: outcome !== "shown",
      firstTry: outcome === "good",
      hintsUsed: outcome === "hint" ? 1 : 0,
      wrongMovesUci: wrong.length ? wrong : outcome === "wrong" || outcome === "shown" ? ["h2h3"] : [],
      solutionShown: outcome === "shown",
      timeMs: 12_000,
      grade: grade === undefined ? suggested : grade,
      suggestedGrade: suggested,
      cardReps: item.cardReps,
      reviewedAt: at.toISOString(),
    };
  }

  const post = (m: Member, attempts: AttemptIn[], now = WORLD_NOW, viewer?: ReturnType<typeof w.viewerOf>) =>
    w.call("attempts", "POST", "/api/train/attempts", m, { body: { attempts }, now, ...(viewer ? { viewer } : {}) });

  async function postOk(m: Member, attempts: AttemptIn[], now = WORLD_NOW) {
    const r = await post(m, attempts, now);
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return { result: ok(AttemptsResult).parse(await r.json()).data, recorded: r.recorded };
  }

  async function card(m: Member, key: string) {
    const rows = await w.db.$queryRaw<{ reps: number; due: Date; state: string; lastReview: Date | null; mastery: number }[]>(Prisma.sql`
      SELECT reps, due, state::text AS state, "lastReview", mastery FROM training_cards WHERE "userId" = ${m.id} AND "itemKey" = ${key}`);
    return rows[0]!;
  }

  async function today(m: Member, day = "2026-11-12") {
    const rows = await w.db.$queryRaw<{ bankReviewed: number; newIntroduced: number; puzzlesDone: number; planDone: number }[]>(Prisma.sql`
      SELECT "bankReviewed", "newIntroduced", "puzzlesDone", "planDone" FROM training_days WHERE "userId" = ${m.id} AND day = ${day}::date`);
    return rows[0] ?? { bankReviewed: 0, newIntroduced: 0, puzzlesDone: 0, planDone: 0 };
  }

  it("a bank drill: Good / Hard / Again; the cap counters; the Again re-queue; the resume index; duplicates", async () => {
    const m = await w.member("drill");
    await w.persona(m, "bank-member");
    const s = await create(m, { kind: "bank", source: "hub" });
    const [a, b, c] = s.items;
    const t0 = new Date(WORLD_NOW.getTime() + MIN);
    const batch = [attempt(s, a!, "good", t0), attempt(s, b!, "hint", new Date(t0.getTime() + MIN)), attempt(s, c!, "wrong", new Date(t0.getTime() + 2 * MIN))];
    const { result, recorded } = await postOk(m, batch, new Date(t0.getTime() + 3 * MIN));
    assert.deepEqual(result.results.map((x) => x.status), ["ok", "ok", "ok"]);
    assert.equal(result.results[0]!.card!.scheduled, true);
    assert.equal(result.results[2]!.card!.requeued, true, "Again on pass 1 re-queues");
    assert.equal(result.capRemaining, 7);
    assert.equal(result.bankDue, 1);
    const counters = await today(m);
    assert.equal(counters.bankReviewed, 3);
    for (const [i, it] of [a!, b!, c!].entries()) {
      const row = await card(m, it.cardRef!);
      assert.equal(row.reps, it.cardReps! + 1, `card ${i} reps`);
      assert.ok(row.lastReview);
    }
    // The pass-2 copy is in the session now, at min(i + 4, length).
    const r3 = ok(SessionPayload).parse(await (await w.call("session", "GET", `/api/train/sessions/${s.ref}`, m, { params: { ref: s.ref }, now: new Date(t0.getTime() + 4 * MIN) })).json()).data;
    assert.equal(r3.items.length, 5);
    assert.equal(r3.items[4]!.itemId, `${c!.itemId}b`);
    assert.equal(r3.items[4]!.pass, 2);
    assert.equal(r3.resumeIndex, 3, "graded items are never repeated");
    // A duplicate leaves the card as it is.
    const before = await card(m, a!.cardRef!);
    const dup = await postOk(m, [batch[0]!], new Date(t0.getTime() + 5 * MIN));
    assert.equal(dup.result.results[0]!.status, "duplicate");
    assert.deepEqual(await card(m, a!.cardRef!), before);
    // The pass-2 copy (it carries the pass-1 reps) is accepted, and does not count toward the cap again.
    const pass2 = r3.items[4]!;
    const p2 = await postOk(m, [attempt(s, pass2, "good", new Date(t0.getTime() + 15 * MIN))], new Date(t0.getTime() + 16 * MIN));
    assert.equal(p2.result.results[0]!.status, "ok");
    assert.equal((await today(m)).bankReviewed, 3);
    // after(): the server event once per flush.
    const events: string[] = [];
    const { setTrainEventSink } = await import("@/lib/train/events.server");
    const restore = setTrainEventSink((e) => events.push(e));
    try {
      await w.runAfter(recorded);
    } finally {
      restore();
    }
    assert.deepEqual(events, ["train_attempts_applied"]);
  });

  it("a stale cardReps → conflict and no attempt row; an unknown card → not_found; the first wrong move = the answer → bad_item", async () => {
    const m = await w.member("conflict");
    await w.persona(m, "bank-member");
    const s = await create(m, { kind: "bank", source: "hub" });
    const it = s.items[0]!;
    const stale = { ...attempt(s, it, "good", WORLD_NOW), cardReps: it.cardReps! + 5 };
    const unknown = { ...attempt(null, it, "good", WORLD_NOW), cardRef: "m_zzzzzzzzzzzz" };
    const bad = { ...attempt(s, s.items[1]!, "wrong", WORLD_NOW), wrongMovesUci: [s.items[1]!.solution[0]!] };
    const { result } = await postOk(m, [stale, unknown, bad]);
    assert.deepEqual(result.results.map((r) => [r.status, r.reason ?? null]), [["conflict", null], ["rejected", "not_found"], ["rejected", "bad_item"]]);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${m.id} AND "createdAt" > now() - interval '1 minute'`), 0);
  });

  it("a non-member's batch → 402 and nothing applied", async () => {
    const m = await w.member("lapsedw1");
    await w.persona(m, "bank-member");
    const s = await create(m, { kind: "bank", source: "hub" });
    const attempts = () => count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_attempts WHERE "userId" = ${m.id}`);
    const before = await attempts();
    const cardBefore = await card(m, s.items[0]!.cardRef!);
    const r = await post(m, [attempt(s, s.items[0]!, "good", WORLD_NOW)], WORLD_NOW, nonMember(w, m));
    assert.equal(r.res.status, 402);
    assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "subscription_required");
    assert.equal(await attempts(), before);
    assert.deepEqual(await card(m, s.items[0]!.cardRef!), cardBefore);
  });

  it("offline replay: reviewedAt order with now = reviewedAt; 10 days old is clamped; 15 days with `stale` → too_old", async () => {
    const m = await w.member("offline");
    await w.persona(m, "bank-member");
    const s = await create(m, { kind: "bank", source: "hub" });
    const t = (min: number) => new Date(WORLD_NOW.getTime() + min * MIN);
    const late = attempt(s, s.items[0]!, "good", t(3));
    const early = attempt(s, s.items[1]!, "good", t(1));
    // A sessionless grade (a card picked outside a session; no shipped client sends one) dated 10 days back is dated by
    // the server's clock instead (FIX-2, P5-FX-14: no session start bounds it, so it can never fill a past day).
    // A session's attempt is never dated before its session started (FIX-1 streak forging: no earlier days filled).
    const old = { ...attempt(null, s.items[2]!, "good", new Date(WORLD_NOW.getTime() - 10 * DAY)), itemId: null };
    const beforeStart = attempt(s, s.items[3]!, "good", new Date(WORLD_NOW.getTime() - 2 * DAY));
    const tooOld = { ...attempt(null, s.items[3]!, "good", new Date(WORLD_NOW.getTime() - 15 * DAY)), itemId: null, stale: true };
    const { result } = await postOk(m, [late, early, old, tooOld, beforeStart], t(10));
    assert.deepEqual(result.results.map((r) => r.status), ["ok", "ok", "ok", "rejected", "ok"]);
    assert.equal(result.results[3]!.reason, "too_old");
    const rows = await w.db.$queryRaw<{ id: string; reviewedAt: Date }[]>(Prisma.sql`
      SELECT "clientAttemptId"::text AS id, "reviewedAt" FROM training_attempts WHERE "userId" = ${m.id} ORDER BY id`);
    const at = new Map(rows.map((r) => [r.id, r.reviewedAt.getTime()]));
    assert.equal(at.get(old.clientAttemptId), t(10).getTime(), "the sessionless grade is dated at the server's clock, not 10 days back");
    assert.ok(at.get(early.clientAttemptId)! < at.get(late.clientAttemptId)!);
    assert.equal(at.get(beforeStart.clientAttemptId), WORLD_NOW.getTime(), "raised to the session's start");
    const streak = await w.db.$queryRaw<{ dayStreak: number }[]>(Prisma.sql`SELECT "dayStreak" FROM training_profiles WHERE "userId" = ${m.id}`);
    assert.ok(streak[0]!.dayStreak <= 5, "the 2-days-back session attempt added no earlier day");
    // Graded with now = reviewedAt: the early card's lastReview is its own reviewedAt.
    assert.equal((await card(m, s.items[1]!.cardRef!)).lastReview!.getTime(), t(1).getTime());
  });

  it("the once-a-day rule: an explicit pick of a card reviewed today is logged as practice (scheduledDays null), the card untouched", async () => {
    const m = await w.member("onceaday");
    await w.persona(m, "bank-member");
    const s = await create(m, { kind: "bank", source: "hub" });
    const it = s.items[0]!;
    await postOk(m, [attempt(s, it, "good", WORLD_NOW)]);
    const after1 = await card(m, it.cardRef!);
    const pick = await create(m, { kind: "bank", source: "solve_one", cardRefs: [it.cardRef!] }, new Date(WORLD_NOW.getTime() + 5 * MIN));
    const { result } = await postOk(m, [attempt(pick, pick.items[0]!, "good", new Date(WORLD_NOW.getTime() + 6 * MIN))], new Date(WORLD_NOW.getTime() + 7 * MIN));
    assert.equal(result.results[0]!.status, "ok");
    assert.equal(result.results[0]!.card!.scheduled, false);
    assert.deepEqual(await card(m, it.cardRef!), after1);
    const sd = await w.db.$queryRaw<{ sd: number | null }[]>(Prisma.sql`
      SELECT "scheduledDays" AS sd FROM training_attempts WHERE "clientAttemptId" = ${result.results[0]!.clientAttemptId}::uuid`);
    assert.equal(sd[0]!.sd, null);
    // A PRACTICE session never reschedules either.
    const pr = await create(m, { kind: "practice", fromSessionRef: s.ref }, new Date(WORLD_NOW.getTime() + 8 * MIN));
    const p = await postOk(m, [attempt(pr, pr.items[1]!, "good", new Date(WORLD_NOW.getTime() + 9 * MIN))], new Date(WORLD_NOW.getTime() + 10 * MIN));
    assert.equal(p.result.results[0]!.card!.scheduled, false);
  });

  it("the plan bit when the last frozen card is graded; the day streak +1 once a day; NEW cards count as introduced", async () => {
    const m = await w.member("plan");
    await w.persona(m, "train-plan");
    const hub = ok(TrainToday).parse(await (await w.call("today", "GET", "/api/train/today", m)).json()).data;
    assert.equal(hub.plan.steps[0]!.kind, "bank");
    const s = await create(m, { kind: "daily", source: "plan" });
    const bank = s.items.filter((i) => i.kind !== "puzzle");
    assert.equal(bank.length, 3);
    const streakBefore = hub.streak.current;
    const first = await postOk(m, [attempt(s, bank[0]!, "good", WORLD_NOW)]);
    assert.equal(first.result.planDone & 1, 0);
    const second = await postOk(m, bank.slice(1).map((it, i) => attempt(s, it, "good", new Date(WORLD_NOW.getTime() + (i + 1) * MIN))), new Date(WORLD_NOW.getTime() + 5 * MIN));
    assert.equal(second.result.planDone & 1, 1, "the bank step is done");
    const streaks = [...first.result.results, ...second.result.results].map((r) => r.dayStreak);
    assert.ok(streaks.every((x) => x === streaks[0]), "one increment per day");
    assert.equal(streaks[0], streakBefore + 1);
    const counters = await today(m);
    assert.equal(counters.newIntroduced, 3, "the three cards were NEW");
    const after = ok(TrainToday).parse(await (await w.call("today", "GET", "/api/train/today", m, { now: new Date(WORLD_NOW.getTime() + 10 * MIN) })).json()).data;
    assert.equal(after.plan.done, 1);
    assert.equal(after.plan.steps[0]!.status, "done");
  });

  it("puzzles: Glicko from the objective score; a PUZZLE card only for a miss (Again / Hard), none for a clean solve", async () => {
    const m = await w.member("glicko");
    await w.persona(m, "puzzles-fresh");
    const s = await create(m, { kind: "puzzles", source: "nav", theme: "fork" });
    const [p1, p2, p3] = s.items;
    const { result } = await postOk(m, [
      attempt(s, p1!, "good", WORLD_NOW),
      attempt(s, p2!, "hint", new Date(WORLD_NOW.getTime() + MIN)),
      attempt(s, p3!, "shown", new Date(WORLD_NOW.getTime() + 2 * MIN)),
    ], new Date(WORLD_NOW.getTime() + 3 * MIN));
    assert.deepEqual(result.results.map((r) => r.status), ["ok", "ok", "ok"]);
    assert.ok(result.results[0]!.rating!.delta > 0, "a clean solve raises the rating");
    assert.ok(result.results[2]!.rating!.delta < 0, "the solution shown lowers it");
    assert.equal(result.results[0]!.card, undefined, "a clean solve makes no card");
    assert.equal(result.results[1]!.card!.ref, `p_${p2!.puzzleId}`);
    assert.equal(result.results[2]!.card!.ref, `p_${p3!.puzzleId}`);
    assert.equal(await count(w.db, Prisma.sql`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${m.id} AND deck = 'PUZZLE'`), 2);
    assert.equal((await today(m)).puzzlesDone, 3);
    const prof = await w.db.$queryRaw<{ r: number; n: number }[]>(Prisma.sql`SELECT "puzzleRating" AS r, "puzzleAttempts" AS n FROM training_profiles WHERE "userId" = ${m.id}`);
    assert.equal(prof[0]!.n, 3);
    assert.equal(Math.round(prof[0]!.r), result.results[2]!.rating!.value);
  });

  it("theme mastery: the milestone fires once", async () => {
    const m = await w.member("milestone");
    await w.persona(m, "bank-member");
    // Forks sit at 62 % (persona); a few clean fork solves cross 70 %.
    await w.db.$executeRaw(Prisma.sql`UPDATE theme_mastery SET ewma = 0.69, "milestonePct" = 50, attempts = 20 WHERE "userId" = ${m.id} AND theme = 'fork'`);
    const forks = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`SELECT "itemKey" FROM training_cards WHERE "userId" = ${m.id} AND theme = 'fork' ORDER BY id LIMIT 3`)).map((r) => r.itemKey);
    assert.ok(forks.length >= 2);
    const s = await create(m, { kind: "bank", source: "bank", cardRefs: forks });
    const { result } = await postOk(m, s.items.map((it, i) => attempt(s, it, "good", new Date(WORLD_NOW.getTime() + i * MIN))), new Date(WORLD_NOW.getTime() + 10 * MIN));
    const milestones = result.results.flatMap((r) => (r.theme?.milestone ? [r.theme.milestone] : []));
    assert.deepEqual(milestones, [70]);
  });

  it("a 50-item batch applies in < 150 ms", async () => {
    const m = await w.member("fifty");
    await w.persona(m, "bank-member");
    const keys = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`SELECT "itemKey" FROM training_cards WHERE "userId" = ${m.id} ORDER BY id LIMIT 20`)).map((r) => r.itemKey);
    const s = await create(m, { kind: "bank", source: "bank", cardRefs: keys });
    // Warm the code paths once (the first call loads modules), then measure a fresh member's 50 attempts.
    await postOk(m, [attempt(s, s.items[0]!, "good", WORLD_NOW)]);
    const m2 = await w.member("fifty2");
    await w.persona(m2, "bank-member");
    const keys2 = (await w.db.$queryRaw<{ itemKey: string }[]>(Prisma.sql`SELECT "itemKey" FROM training_cards WHERE "userId" = ${m2.id} ORDER BY id LIMIT 20`)).map((r) => r.itemKey);
    const s2 = await create(m2, { kind: "bank", source: "bank", cardRefs: keys2 });
    const attempts: AttemptIn[] = [];
    for (let i = 0; i < 50; i++) {
      const it = s2.items[i % s2.items.length]!;
      // Repeats of a card in one batch carry its reps after the earlier grades: the later ones are conflicts or practice.
      attempts.push(attempt(s2, it, "good", new Date(WORLD_NOW.getTime() + i * 1000)));
    }
    const started = performance.now();
    const out = await applyAttempts(w.viewerOf(m2), attempts, new Date(WORLD_NOW.getTime() + 60 * MIN));
    const ms = performance.now() - started;
    assert.equal(out.result.results.length, 50);
    assert.ok(ms < 150, `50 attempts took ${ms.toFixed(1)} ms`);
  });

  it("concurrency (AP-27): J1-shaped batches commit in a loop while 200 W1 batches run: p95 < 300 ms, no deadlock, no lost EWMA update", async () => {
    const m = await w.member("concur");
    await w.persona(m, "bank-member");
    const rows = await w.db.$queryRaw<{ itemKey: string; theme: string }[]>(Prisma.sql`
      SELECT "itemKey", theme FROM training_cards WHERE "userId" = ${m.id} AND theme = 'fork' ORDER BY id LIMIT 2`);
    assert.equal(rows.length, 2);
    const mastery0 = (await w.db.$queryRaw<{ attempts: number }[]>(Prisma.sql`SELECT attempts FROM theme_mastery WHERE "userId" = ${m.id} AND theme = 'fork'`))[0]!.attempts;
    // Two "devices", one card each (same theme), each flushing 100 single-attempt batches; each batch grades its card
    // Again outside a session (a relearning card is rescheduled by every grade, so the card is touched every time; a
    // session item is graded once, FIX-1).
    const [sa, sb] = [await create(m, { kind: "bank", source: "bank", cardRefs: [rows[0]!.itemKey] }), await create(m, { kind: "bank", source: "bank", cardRefs: [rows[1]!.itemKey] })];
    let stop = false;
    let j1Batches = 0;
    const j1 = (async () => {
      // J1's shape (WP-C's statements in one non-interactive batch): refresh the member's mistakes on the natural key,
      // pull their cards' due to the next release, bump the theme's bankCount.
      while (!stop) {
        await w.db.$transaction([
          w.db.$executeRaw(Prisma.sql`UPDATE mistakes SET "lastPlayedAt" = "lastPlayedAt", "updatedAt" = now() WHERE "userId" = ${m.id}`),
          w.db.$executeRaw(Prisma.sql`UPDATE training_cards SET due = LEAST(due, due + interval '0 days'), "updatedAt" = now()
                                      WHERE "userId" = ${m.id} AND deck = 'BANK' AND theme = 'fork'`),
          w.db.$executeRaw(Prisma.sql`INSERT INTO theme_mastery ("userId", theme, "bankCount") VALUES (${m.id}, 'fork', 0)
                                      ON CONFLICT ("userId", theme) DO UPDATE SET "bankCount" = theme_mastery."bankCount"`),
        ]);
        j1Batches += 1;
      }
    })();
    const times: number[] = [];
    let reps = { a: sa.items[0]!.cardReps!, b: sb.items[0]!.cardReps! };
    const device = async (s: SessionPayload, which: "a" | "b") => {
      for (let i = 0; i < 100; i++) {
        const it = { ...s.items[0]!, cardReps: reps[which] };
        const at = new Date(WORLD_NOW.getTime() + (i + 1) * 1000);
        const started = performance.now();
        const out = await applyAttempts(w.viewerOf(m), [{ ...attempt(null, it, "wrong", at), itemId: null }], new Date(at.getTime() + 500));
        times.push(performance.now() - started);
        const r = out.result.results[0]!;
        assert.equal(r.status, "ok", JSON.stringify(r));
        reps = { ...reps, [which]: r.card!.reps };
      }
    };
    try {
      await Promise.all([device(sa, "a"), device(sb, "b")]);
    } finally {
      stop = true;
      await j1;
    }
    assert.ok(j1Batches > 0, "J1 batches committed during the run");
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    assert.ok(p95 < 300, `W1 p95 ${p95.toFixed(1)} ms`);
    const mastery1 = (await w.db.$queryRaw<{ attempts: number }[]>(Prisma.sql`SELECT attempts FROM theme_mastery WHERE "userId" = ${m.id} AND theme = 'fork'`))[0]!.attempts;
    assert.equal(mastery1 - mastery0, 200, "every attempt counted once (no lost update)");
  });
});
