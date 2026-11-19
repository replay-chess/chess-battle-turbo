/**
 * FIX-6 (item 1, D-P6-FIX6-1) on a real Postgres, through the product's routes (W2 sessions, W1 attempts, R2 bank, R1
 * hub, HOME-1) and the P5 persona writer:
 *   regression: bank-counts-follow-grades — the numbers say one thing at every moment of a session: the bank head
 *   ("N due today"), its button (a new session of N, or "Continue … n Left"), the hub's due line and plan step, and
 *   Home's bank card. A card counts toward the daily cap once a day (its first grade); a card graded Again earlier today
 *   comes back due and is served again without using the cap, so it must be counted the same way (staging P24: three
 *   such grades left the head at "7 DUE TODAY" beside "Continue Review · 4 Left", the hub at "Review 8").
 *   Checked after 0, 1, 3 and all grades of a session, while it is left mid-way, and after the day rolls over.
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ok } from "@repo/contracts/http/envelope";
import { HomeData } from "@repo/contracts/http/home";
import { AttemptsResult, BankPage, SessionPayload, TrainToday, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { EMPTY_FILTER, bankSessionBody, ctaOf, poolOf, visibleRowsOf } from "@/components/train/bank/model";
import { trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
const DAY = 86_400_000;

describe("P6 FIX-6 bank, hub and Home counts follow today's grades (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  const read = async (m: Member, now: Date) => {
    const b = await w.call("bank", "GET", "/api/train/bank", m, { now, query: { view: "all" } });
    assert.equal(b.res.status, 200, await b.res.clone().text());
    const t = await w.call("today", "GET", "/api/train/today", m, { now });
    const h = await w.call("home", "GET", "/api/home", m, { now });
    return { bank: ok(BankPage).parse(await b.json()).data, hub: ok(TrainToday).parse(await t.json()).data, home: ok(HomeData).parse(await h.json()).data };
  };
  /** The click on the bank's button: W2 with the page's body. */
  const click = async (m: Member, page: BankPage, now: Date) => {
    const cta = ctaOf(poolOf(page.rows, EMPTY_FILTER), visibleRowsOf(page.rows, EMPTY_FILTER), page.counts.due, page.start ?? null);
    assert.equal(cta.kind, "review", JSON.stringify(cta));
    if (cta.kind !== "review") throw new Error("no review button");
    const r = await w.call("sessions", "POST", "/api/train/sessions", m, { body: bankSessionBody(EMPTY_FILTER, cta), headers: { "Idempotency-Key": w.uuid() }, now });
    assert.ok(r.res.status === 201 || r.res.status === 200, await r.res.clone().text());
    return { cta, s: ok(SessionPayload).parse(await r.json()).data };
  };
  function graded(s: SessionPayload, item: TrainItem, grade: "again" | "good", at: Date): AttemptIn {
    const good = grade === "good";
    return {
      clientAttemptId: w.uuid(), sessionRef: s.ref, itemId: item.itemId, cardRef: item.cardRef, puzzleId: item.puzzleId, kind: item.kind,
      solved: true, firstTry: good, hintsUsed: 0, wrongMovesUci: good ? [] : ["h2h3"], solutionShown: false, timeMs: 9_000,
      grade, suggestedGrade: grade, cardReps: item.cardReps, reviewedAt: at.toISOString(),
    };
  }
  async function grade(m: Member, s: SessionPayload, items: readonly TrainItem[], g: "again" | "good", at: Date) {
    const r = await w.call("attempts", "POST", "/api/train/attempts", m, { body: { attempts: items.map((it, i) => graded(s, it, g, new Date(at.getTime() + i * 1000))) }, now: new Date(at.getTime() + items.length * 1000) });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    const out = ok(AttemptsResult).parse(await r.json()).data;
    assert.ok(out.results.every((x) => x.status === "ok"), JSON.stringify(out.results));
    return out;
  }
  /** Every surface's number at `now`: what is left to review today. */
  async function agree(m: Member, now: Date, label: string, left: number | null) {
    const { bank, hub, home } = await read(m, now);
    const n = bank.counts.due;
    const step = hub.plan.steps.find((s) => s.kind === "bank");
    const row = {
      head: n,
      button: bank.start?.kind === "resume" ? bank.start.remaining : bank.start?.kind === "new" ? bank.start.n : null,
      hubDue: hub.due.shown,
      hubRow: hub.allTraining.bank.due,
      hubStep: step ? (step.status === "done" ? 0 : Number(/^Review (\d+) due/.exec(step.title)?.[1] ?? -1)) : null,
      home: home.bank.due,
    };
    const table = `${label}: ${JSON.stringify(row)}`;
    if (left !== null) assert.equal(n, left, `${table}: the head says what is left (${left})`);
    assert.equal(row.button, n, `${table}: the button`);
    assert.equal(row.hubDue, n, `${table}: the hub's due line`);
    assert.equal(row.hubRow, n, `${table}: the hub's Mistake Bank row`);
    if (row.hubStep !== null) assert.equal(row.hubStep, Math.min(n, 10), `${table}: the hub's plan step`);
    assert.equal(row.home, n, `${table}: Home`);
    return { bank, hub, home, row };
  }

  it("regression: bank-counts-follow-grades — 0, 1, 3 and all grades, mid-session, after an Again, after the rollover", async (t) => {
    const m = await w.member("counts", { timeZone: "UTC" });
    // Ten days on, the persona's bank holds far more due cards than the cap serves.
    await w.persona(m, "bank-member", new Date(WORLD_NOW.getTime() - 10 * DAY));
    const morning = new Date("2026-11-12T08:00:00.000Z");
    const log: string[] = [];
    const note = (x: { row: unknown }, label: string) => log.push(`${label} ${JSON.stringify(x.row)}`);

    // Morning session: today's whole cap, every card graded Again (each counts once toward the cap).
    const start = await agree(m, morning, "0 graded", 10);
    note(start, "0 graded");
    const s1 = (await click(m, start.bank, morning)).s;
    assert.equal(s1.items.length, 10);
    let at = new Date(morning.getTime() + MIN);
    await grade(m, s1, s1.items.slice(0, 1), "again", at);
    // An Again leaves the card to do again today (its short step): still 10 left, 1 of them a retry.
    note(await agree(m, new Date(at.getTime() + 20_000), "1 Again", 10), "1 Again");
    at = new Date(at.getTime() + MIN);
    await grade(m, s1, s1.items.slice(1, 3), "again", at);
    note(await agree(m, new Date(at.getTime() + 20_000), "3 Again", 10), "3 Again");
    at = new Date(at.getTime() + MIN);
    await grade(m, s1, s1.items.slice(3, 10), "again", at);
    // Left mid-way (the Again copies wait in the session). Half an hour on, the ten cards are due again: they do not use
    // the cap a second time, so they are today's work (staging: the head said 0 / 7 beside "Continue … Left").
    const later = new Date(morning.getTime() + 40 * MIN);
    const back = await agree(m, later, "10 Again, 40 min later", 10);
    note(back, "10 Again, 40 min later");
    assert.equal(back.bank.counts.capRemaining, 0, "the cap is used");
    assert.equal(back.bank.start?.kind, "resume", "the button resumes the morning session");
    const r1 = (await click(m, back.bank, later)).s;
    assert.equal(r1.ref, s1.ref);
    const left = r1.items.filter((it) => it.pass === 2);
    assert.equal(left.length, 10, "the ten Again copies are what is left");
    at = new Date(later.getTime() + MIN);
    await grade(m, r1, left.slice(0, 1), "good", at);
    note(await agree(m, new Date(at.getTime() + 20_000), "1 Good", 9), "1 Good");
    at = new Date(at.getTime() + MIN);
    await grade(m, r1, left.slice(1, 3), "good", at);
    note(await agree(m, new Date(at.getTime() + 20_000), "3 Good", 7), "3 Good");
    at = new Date(at.getTime() + MIN);
    await grade(m, r1, left.slice(3), "good", at);
    const done = await agree(m, new Date(at.getTime() + 20_000), "all graded", 0);
    note(done, "all graded");
    assert.equal(done.bank.state, "caughtup");
    assert.equal(done.hub.state, "nothingdue");

    // The next day: a new day's cap, every surface agrees again.
    const tomorrow = new Date(morning.getTime() + DAY);
    const next = await agree(m, tomorrow, "next day", 10);
    note(next, "next day");
    t.diagnostic(log.join("\n"));
  });
});
