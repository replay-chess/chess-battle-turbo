/**
 * FIX-5 (Phase 6 staging re-check, item A) on a real Postgres, through the product's routes and the P5 persona writer:
 *   regression: bank-button-session — the number the bank page gives its primary button (`BankPage.start`) is the
 *   session the start route (W2, `bankSessionBody`'s body) then returns: (1) no active session: a new session of
 *   exactly `n` items, equal to the head's "due today"; (2) an active session with some items graded: "Continue",
 *   with exactly the items left. Case (3), far over the cap with more NEW cards than newPerDay, needs more than 50
 *   real positions: it is in test/api/train-weakness-fix5.int.test.ts (real CC0 games banked through A6).
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ok } from "@repo/contracts/http/envelope";
import { AttemptsResult, BankPage, SessionPayload, type AttemptIn, type TrainItem } from "@repo/contracts/http/train";
import { EMPTY_FILTER, bankSessionBody, ctaOf, poolOf, visibleRowsOf } from "@/components/train/bank/model";
import { trainWorld, WORLD_NOW, type Member } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const MIN = 60_000;
const DAY = 86_400_000;

describe("P6 FIX-5 the bank button opens the session it names (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  before(() => w.setup());
  after(() => w.teardown());

  const bank = async (m: Member, now: Date) => {
    const r = await w.call("bank", "GET", "/api/train/bank", m, { now, query: { view: "all" } });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    return ok(BankPage).parse(await r.json()).data;
  };
  /** The click: W2 with the body the page sends for its primary button (no filter, due cards). */
  const click = async (m: Member, page: BankPage, now: Date) => {
    const cta = ctaOf(poolOf(page.rows, EMPTY_FILTER), visibleRowsOf(page.rows, EMPTY_FILTER), page.counts.due, page.start ?? null);
    assert.equal(cta.kind, "review", JSON.stringify(cta));
    if (cta.kind !== "review") throw new Error("no review button");
    const r = await w.call("sessions", "POST", "/api/train/sessions", m, { body: bankSessionBody(EMPTY_FILTER, cta), headers: { "Idempotency-Key": w.uuid() }, now });
    assert.ok(r.res.status === 201 || r.res.status === 200, await r.res.clone().text());
    return { cta, s: ok(SessionPayload).parse(await r.json()).data, created: r.res.status === 201 };
  };
  const left = (s: SessionPayload) => s.items.length - s.resumeIndex;
  function good(s: SessionPayload, item: TrainItem, at: Date): AttemptIn {
    return {
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
      reviewedAt: at.toISOString(),
    };
  }

  it("regression: bank-button-session (1) no active session: a new session of exactly the button's number, the head's count", async () => {
    const m = await w.member("btnnew");
    await w.persona(m, "bank-member", new Date(WORLD_NOW.getTime() - 10 * DAY));
    const page = await bank(m, WORLD_NOW);
    assert.ok(page.counts.dueRaw > page.counts.due, `more due (${page.counts.dueRaw}) than the cap serves (${page.counts.due})`);
    assert.deepEqual(page.start, { kind: "new", n: page.counts.due }, "the button's session is the head's count");
    const { cta, s, created } = await click(m, page, WORLD_NOW);
    assert.equal(created, true);
    assert.equal(cta.label, `Review ${page.counts.due} Due · ~${Math.max(1, Math.round(0.75 * page.counts.due))} min`);
    assert.equal(s.items.length, page.counts.due, "the session the click opened");
  });

  it("regression: bank-button-session (2) an active session with items graded: Continue, with exactly the items left", async () => {
    const m = await w.member("btnresume");
    await w.persona(m, "bank-member", new Date(WORLD_NOW.getTime() - 10 * DAY));
    const first = await click(m, await bank(m, WORLD_NOW), WORLD_NOW);
    assert.ok(first.s.items.length >= 4, `${first.s.items.length} items`);
    const t0 = new Date(WORLD_NOW.getTime() + MIN);
    const r = await w.call("attempts", "POST", "/api/train/attempts", m, { body: { attempts: first.s.items.slice(0, 3).map((it, i) => good(first.s, it, new Date(t0.getTime() + i * MIN))) }, now: new Date(t0.getTime() + 4 * MIN) });
    assert.equal(r.res.status, 200, await r.res.clone().text());
    assert.ok(ok(AttemptsResult).parse(await r.json()).data.results.every((x) => x.status === "ok"));
    const later = new Date(t0.getTime() + 10 * MIN);
    const page = await bank(m, later);
    assert.equal(page.start?.kind, "resume", JSON.stringify(page.start));
    const { cta, s, created } = await click(m, page, later);
    assert.equal(created, false, "the active session is resumed");
    assert.equal(s.ref, first.s.ref);
    assert.equal(page.start?.kind === "resume" ? page.start.remaining : -1, left(s), "the button's count is what the resumed session has left");
    assert.equal(cta.label, `Continue Review · ${left(s)} Left · ~${Math.max(1, Math.round(0.75 * left(s)))} min`);
    // The staging case: the head said 7 due while the button resumed a session of another size. The head is the day's
    // count; the button now names the session.
    assert.notEqual(cta.label, `Review ${page.counts.due} Due · ~${Math.max(1, Math.round(0.75 * page.counts.due))} min`);
  });
});
