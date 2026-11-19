/**
 * FIX-4 (Phase 6 staging browser pass) on a real Postgres, through the product's routes and the P5 persona writer:
 *   - regression: bank-next-batch-past (item 2) — a training day opened in UTC and pinned by a move to Asia/Calcutta
 *     (the hub's silent time-zone PATCH) runs until 04:00Z (09:30 IST). The bank, the hub and Home read one next batch,
 *     at every instant around the IST and UTC rollovers: never at or before the instant, on the day after the clock's
 *     day (staging: "NEXT BATCH TODAY 04:00" at 04:42 IST, 22:30Z, while R1 still said Wednesday), with day words that
 *     count the clock's days;
 *   - regression: bank-cta-uncapped (item 3) — with more cards due than the cap serves, the bank's button (the page
 *     model over the real page) names today's count, and the session it starts serves exactly that many;
 *   - regression: hub-plan-stale (item 8) — the frozen plan's puzzle step reads the member's live puzzle rating after
 *     a failed puzzle session (it kept the rating it was frozen with);
 *   - regression: summary-improving-zero (item 11) — a bank session with no first-try answer never says "improving",
 *     and the theme line agrees in number with any theme name.
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { AttemptsResult, BankPage, SessionPayload, SessionSummary, TrainToday, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { addDaysToKey } from "@repo/chess-training/day";
import { ctaOf, poolOf, visibleRowsOf } from "@/components/train/bank/model";
import { batchDayWord } from "@/components/train/hub/when";
import { startPuzzleShardServer } from "../../../e2e/mocks/puzzle-shards";
import { trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
type Outcome = "good" | "wrong" | "shown";

describe("P6 FIX-4 day boundary, bank counts, live plan step, summary line (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
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
  /** An attempt as the runner builds it (attempts.contract.int.test.ts). */
  function attempt(s: SessionPayload, item: TrainItem, outcome: Outcome, at: Date): AttemptIn {
    const wrong = outcome === "good" ? [] : ["a2a3", "h2h3"].filter((u) => u !== item.solution[0] && !item.accept.includes(u)).slice(0, 1);
    const suggested = outcome === "good" ? "good" : "again";
    return {
      clientAttemptId: w.uuid(),
      sessionRef: s.ref,
      itemId: item.itemId,
      cardRef: item.cardRef,
      puzzleId: item.puzzleId,
      kind: item.kind,
      solved: outcome !== "shown",
      firstTry: outcome === "good",
      hintsUsed: 0,
      wrongMovesUci: wrong,
      solutionShown: outcome === "shown",
      timeMs: 12_000,
      grade: suggested,
      suggestedGrade: suggested,
      cardReps: item.cardReps,
      reviewedAt: at.toISOString(),
    };
  }
  async function post(m: Member, attempts: AttemptIn[], now: Date) {
    const r = await w.call("attempts", "POST", "/api/train/attempts", m, { body: { attempts }, now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(AttemptsResult).parse(await r.json()).data;
  }
  const today = async (m: Member, now: Date) => ok(TrainToday).parse(await (await w.call("today", "GET", "/api/train/today", m, { now })).json()).data;
  const bank = async (m: Member, now: Date) => {
    const r = await w.call("bank", "GET", "/api/train/bank", m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(BankPage).parse(await r.json()).data;
  };
  const home = async (m: Member, now: Date) => {
    const r = await w.call("home", "GET", "/api/home", m, { now });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(HomeData).parse(await r.json()).data;
  };

  it("regression: bank-next-batch-past — a pinned day: bank, hub and Home read one next batch, never in the past, on the clock's days", async () => {
    const m = await w.member("pinbatch", { timeZone: "UTC" });
    // The bank-member persona ten days earlier: by Saturday most of its 41 cards are due, far more than the cap serves.
    await w.persona(m, "bank-member", new Date("2026-11-04T10:00:00.000Z"));
    await w.db.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = 'UTC' WHERE id = ${m.id}`);
    m.timeZone = "UTC";
    const saturday = new Date("2026-11-14T10:00:00.000Z");
    assert.equal((await today(m, saturday)).dayKey, "2026-11-14", "Saturday's row opened in UTC");
    const zone = await w.call("prefs", "PATCH", "/api/train/prefs", m, { body: { timeZone: "Asia/Calcutta", dayStartHour: 4 }, now: saturday });
    assert.equal(zone.res.status, 200, await zone.res.clone().text());
    m.timeZone = "Asia/Calcutta";

    const instants: [string, string][] = [
      ["2026-11-14T22:29:00.000Z", "2026-11-14"], // 03:59 IST Sunday
      ["2026-11-14T22:31:00.000Z", "2026-11-14"], // 04:01 IST: the IST day would start, the pinned one goes on
      ["2026-11-14T23:12:00.000Z", "2026-11-14"], // 04:42 IST: the staging read
      ["2026-11-15T02:31:00.000Z", "2026-11-14"], // 08:01 IST: the release
      ["2026-11-15T03:59:00.000Z", "2026-11-14"], // 09:29 IST
      ["2026-11-15T04:01:00.000Z", "2026-11-15"], // 09:31 IST: Sunday
      ["2026-11-15T22:29:00.000Z", "2026-11-15"], // 03:59 IST Monday
      ["2026-11-15T22:31:00.000Z", "2026-11-16"], // 04:01 IST Monday: the zone's own days again
    ];
    // The reads go forward in time once (each read can open that day's row). The invariant staging broke is checked
    // at every instant first: the one next batch is after the instant; then the days and the words.
    const reads: { iso: string; dayKey: string; t: TrainToday; b: BankPage; h: HomeData }[] = [];
    for (const [iso, dayKey] of instants) {
      const now = new Date(iso);
      const [t, b, h] = [await today(m, now), await bank(m, now), await home(m, now)];
      assert.ok(b.nextBatch && Date.parse(b.nextBatch.at) > now.getTime(), `${iso}: the next batch (${b.nextBatch?.at}, "${b.nextBatch?.whenLabel}") is after the instant`);
      assert.deepEqual([t.nextBatch, h.bank.nextBatch], [b.nextBatch, b.nextBatch], `${iso}: bank, hub and Home read one next batch`);
      reads.push({ iso, dayKey, t, b, h });
    }
    for (const { iso, dayKey, t, b, h } of reads) {
      const now = new Date(iso);
      assert.equal(t.dayKey, dayKey, `${iso}: the clock's day`);
      assert.ok(b.counts.due <= (b.counts.cap ?? 10), `${iso}: the head never passes the cap`);
      assert.ok(b.counts.dueRaw > b.counts.due, `${iso}: the cap holds cards back (the persona's ${b.counts.dueRaw} due)`);
      const nb = b.nextBatch;
      assert.ok(nb, `${iso}: held-back cards make a next batch`);
      assert.deepEqual(t.nextBatch, nb, `${iso}: the hub reads the bank's next batch`);
      assert.deepEqual(h.bank.nextBatch, nb, `${iso}: Home reads the bank's next batch`);
      assert.ok(Date.parse(nb.at) > now.getTime(), `${iso}: the next batch (${nb.at}) is after the instant`);
      assert.equal(nb.todayKey, dayKey);
      if (nb.dayKey === dayKey) {
        // Room left under today's cap for a card falling due later in the clock's day.
        assert.ok(Date.parse(nb.at) < Date.parse(nb.todayEndsAt!), `${iso}: today's batch is inside the clock's day`);
        assert.match(nb.whenLabel!, /^today at /, `${iso}: ${nb.whenLabel}`);
        assert.equal(batchDayWord(nb, now.getTime(), m.timeZone, 4, t.dayKey), "today", `${iso}: the hub's word`);
        assert.equal(batchDayWord(nb, now.getTime(), m.timeZone, 4), "today", `${iso}: the bank's word`);
      } else {
        assert.equal(nb.dayKey, addDaysToKey(dayKey, 1), `${iso}: the cap is used for today, so the batch is the next training day's`);
        assert.ok(Date.parse(nb.at) >= Date.parse(nb.todayEndsAt!), `${iso}: the next day starts when the clock's day ends`);
        assert.match(nb.whenLabel!, /^tomorrow at /, `${iso}: ${nb.whenLabel}`);
        assert.equal(batchDayWord(nb, now.getTime(), m.timeZone, 4, t.dayKey), "tomorrow", `${iso}: the hub's word`);
        assert.equal(batchDayWord(nb, now.getTime(), m.timeZone, 4), "tomorrow", `${iso}: the bank's word (no header day)`);
        assert.deepEqual(b.upcoming[0], { label: "Tomorrow", n: nb.count }, `${iso}: Coming up starts with the next batch`);
      }
      if (iso === "2026-11-14T23:12:00.000Z") {
        // The staging read (04:42 IST): Saturday's cap is used, so the held-back cards come when Sunday starts, 04:00Z
        // = 09:30 IST (it read "today 04:00", 22:30Z, already past).
        assert.equal(b.counts.due, b.counts.cap ?? 10, "today serves the full cap");
        assert.equal(nb.at, "2026-11-15T04:00:00.000Z");
        assert.equal(nb.whenLabel, "tomorrow at 09:30");
      }
    }
  });

  it("regression: bank-cta-uncapped — more due than the cap: the button names today's count and its session serves that many", async () => {
    const m = await w.member("ctacap", { timeZone: "UTC" });
    await w.persona(m, "bank-member", new Date("2026-11-02T10:00:00.000Z"));
    await w.db.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = 'UTC' WHERE id = ${m.id}`);
    m.timeZone = "UTC";
    const page = await bank(m, WORLD_NOW);
    assert.ok(page.counts.dueRaw > page.counts.due && page.counts.due > 0, `due ${page.counts.due} of ${page.counts.dueRaw}`);
    const rows = page.rows;
    const all = { view: null, theme: null, phase: null, source: null } as unknown as Parameters<typeof poolOf>[1];
    const cta = ctaOf(poolOf(rows, all), visibleRowsOf(rows, all), page.counts.due);
    assert.equal(cta.kind, "review");
    assert.equal(cta.kind === "review" ? cta.label : "", `Review ${page.counts.due} Due · ~${Math.max(1, Math.round(0.75 * page.counts.due))} min`);
    // The session the button starts (bankSessionBody: kind bank, no filter) serves exactly that many.
    const s = await create(m, { kind: "bank", source: "bank", practice: false });
    assert.equal(s.items.length, page.counts.due);
  });

  it("regression: hub-plan-stale — the frozen puzzle step reads the live puzzle rating", async () => {
    const m = await w.member("liverating");
    await w.persona(m, "bank-member");
    const first = await today(m, WORLD_NOW);
    const step = first.plan.steps.find((s) => s.kind === "puzzles")!;
    const frozenRating = Number(/rating (\d+)/.exec(step.subtitle)![1]);
    // A puzzle session where every puzzle is failed: the Glicko rating falls.
    const p = await create(m, { kind: "puzzles", source: "nav", theme: "fork" });
    const t0 = new Date(WORLD_NOW.getTime() + MIN);
    await post(m, p.items.slice(0, 5).map((it, i) => attempt(p, it, "shown", new Date(t0.getTime() + i * MIN))), new Date(t0.getTime() + 6 * MIN));
    const [prof] = await w.db.$queryRaw<{ r: number }[]>(Prisma.sql`SELECT "puzzleRating" AS r FROM training_profiles WHERE "userId" = ${m.id}`);
    const live = Math.round(Number(prof!.r));
    assert.ok(live < frozenRating, `the rating fell: ${frozenRating} → ${live}`);
    const later = await today(m, new Date(t0.getTime() + 10 * MIN));
    assert.equal(later.dayKey, first.dayKey, "the same training day: the plan is the frozen one");
    const now = later.plan.steps.find((s) => s.kind === "puzzles")!;
    assert.equal(now.title, step.title, "the frozen step");
    assert.equal(now.subtitle, step.subtitle.replace(`rating ${frozenRating}`, `rating ${live}`));
    assert.equal(later.puzzleRating.value, live, "the hub's rating and the step agree");
  });

  it("regression: summary-improving-zero — no first-try answer never reads 'improving', and the line agrees with any theme name", async () => {
    const m = await w.member("summaryline");
    // Ten days on, the persona's bank holds several due cards of one theme: a session of that theme only.
    const at = new Date(WORLD_NOW.getTime() + 10 * 86_400_000);
    await w.persona(m, "bank-member");
    const [top] = await w.db.$queryRaw<{ theme: string; n: number }[]>(Prisma.sql`
      SELECT theme, count(*)::int AS n FROM training_cards WHERE "userId" = ${m.id} AND deck = 'BANK' AND due <= ${at.toISOString().replace("Z", "")}::timestamp
       GROUP BY theme ORDER BY 2 DESC, 1 LIMIT 1`);
    assert.ok(top && top.n >= 3, `the persona's most common due theme: ${JSON.stringify(top)}`);
    const s = await create(m, { kind: "bank", source: "bank", filter: { theme: top.theme } }, at);
    assert.ok(s.items.length >= 3, `${s.items.length} items`);
    const t0 = new Date(at.getTime() + MIN);
    const r = await post(m, s.items.map((it, i) => attempt(s, it, "wrong", new Date(t0.getTime() + i * MIN))), new Date(t0.getTime() + 20 * MIN));
    assert.ok(r.results.every((x) => x.status === "ok"));
    const end = await w.call("end", "POST", `/api/train/sessions/${s.ref}/end`, m, { params: { ref: s.ref }, body: { reason: "done" }, now: new Date(t0.getTime() + 21 * MIN) });
    assert.equal(end.res.status, 200, await end.res.clone().text());
    const sum = ok(SessionSummary).parse(await end.json()).data;
    assert.equal(sum.stats.firstTry, 0);
    assert.doesNotMatch(sum.subtitle, /improving/, sum.subtitle);
    assert.equal(sum.themes[0]?.key, top.theme);
    assert.match(sum.subtitle, / positions: 0 of \d+ found on the first try\.$/, sum.subtitle);
  });
});
