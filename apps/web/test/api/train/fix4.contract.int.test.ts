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
import { weekdayLabel } from "@repo/chess-training/labels";
import { formatYmd, localDate } from "@repo/chess-training/tz";
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

    // Each instant with the member's local time and calendar date (Asia/Calcutta), the clock's training day and the
    // words on screen. FIX-5 (item B, D-P6-FIX5-2) changed the words: a clock time is worded by its calendar date
    // ("today at 09:30" at 04:42 Sunday, it read "tomorrow at 09:30"), the Coming-up days by the member's calendar
    // ("Later today" for the training day that starts later on today's date), and the header names a training day that
    // is no longer today's date as "{weekday}'s plan".
    type Row = { iso: string; local: string; calendar: string; dayKey: string; header: string; when: string; first: string };
    const instants: Row[] = [
      { iso: "2026-11-14T22:29:00.000Z", local: "Sun 03:59", calendar: "2026-11-15", dayKey: "2026-11-14", header: "Saturday's plan", when: "today at 09:30", first: "Later today" },
      { iso: "2026-11-14T22:31:00.000Z", local: "Sun 04:01", calendar: "2026-11-15", dayKey: "2026-11-14", header: "Saturday's plan", when: "today at 09:30", first: "Later today" },
      { iso: "2026-11-14T23:12:00.000Z", local: "Sun 04:42", calendar: "2026-11-15", dayKey: "2026-11-14", header: "Saturday's plan", when: "today at 09:30", first: "Later today" },
      { iso: "2026-11-15T02:31:00.000Z", local: "Sun 08:01", calendar: "2026-11-15", dayKey: "2026-11-14", header: "Saturday's plan", when: "today at 09:30", first: "Later today" },
      { iso: "2026-11-15T03:59:00.000Z", local: "Sun 09:29", calendar: "2026-11-15", dayKey: "2026-11-14", header: "Saturday's plan", when: "today at 09:30", first: "Later today" },
      { iso: "2026-11-15T04:01:00.000Z", local: "Sun 09:31", calendar: "2026-11-15", dayKey: "2026-11-15", header: "Sunday", when: "tomorrow at 04:00", first: "Tomorrow" },
      { iso: "2026-11-15T22:29:00.000Z", local: "Mon 03:59", calendar: "2026-11-16", dayKey: "2026-11-15", header: "Sunday's plan", when: "today at 04:00", first: "Later today" },
      { iso: "2026-11-15T22:31:00.000Z", local: "Mon 04:01", calendar: "2026-11-16", dayKey: "2026-11-16", header: "Monday", when: "tomorrow at 04:00", first: "Tomorrow" },
    ];
    // The reads go forward in time once (each read can open that day's row). The invariant staging broke is checked
    // at every instant first: the one next batch is after the instant; then the days and the words.
    const reads: { r: Row; t: TrainToday; b: BankPage; h: HomeData }[] = [];
    for (const r of instants) {
      const now = new Date(r.iso);
      const [t, b, h] = [await today(m, now), await bank(m, now), await home(m, now)];
      assert.ok(b.nextBatch && Date.parse(b.nextBatch.at) > now.getTime(), `${r.iso}: the next batch (${b.nextBatch?.at}, "${b.nextBatch?.whenLabel}") is after the instant`);
      assert.deepEqual([t.nextBatch, h.bank.nextBatch], [b.nextBatch, b.nextBatch], `${r.iso}: bank, hub and Home read one next batch`);
      reads.push({ r, t, b, h });
    }
    for (const { r, t, b } of reads) {
      const now = new Date(r.iso);
      const where = `${r.iso} (${r.local} IST, calendar ${r.calendar})`;
      assert.equal(formatYmd(localDate(now, m.timeZone)), r.calendar, `${where}: the member's calendar date`);
      assert.equal(t.dayKey, r.dayKey, `${where}: the clock's training day`);
      assert.equal(t.weekdayLabel, r.header, `${where}: the hub header`);
      assert.ok(b.counts.due <= (b.counts.cap ?? 10), `${where}: the head never passes the cap`);
      assert.ok(b.counts.dueRaw > b.counts.due, `${where}: the cap holds cards back (the persona's ${b.counts.dueRaw} due)`);
      const nb = b.nextBatch!;
      assert.equal(nb.todayKey, r.dayKey);
      assert.equal(nb.dayKey, addDaysToKey(r.dayKey, 1), `${where}: the cap is used for today, so the batch is the next training day's`);
      assert.ok(Date.parse(nb.at) >= Date.parse(nb.todayEndsAt!), `${where}: the next day starts when the clock's day ends`);
      assert.equal(nb.whenLabel, r.when, `${where}: the server's words (bank head, Home, hub line)`);
      assert.equal(batchDayWord(nb, now.getTime(), m.timeZone), r.when.split(" at ")[0], `${where}: the browser's word (bank and hub)`);
      assert.deepEqual(b.upcoming[0], { label: r.first, n: nb.count }, `${where}: Coming up starts with the next batch`);
      assert.ok(!b.upcoming.some((u) => u.label === weekdayLabel(addDaysToKey(r.calendar, -1))), `${where}: no weekday that has ended is named`);
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
