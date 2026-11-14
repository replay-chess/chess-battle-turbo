// Phase-05 plan §5.5 (realtime events consumed): due counts are written straight into the badge, the viewer payload and
// Home; analysis:done.bankAdded reaches A2's `bank` (the game-over line); a P3 frame without bank fields changes
// nothing; train/home keys go through the injected invalidator; Home patches import and analysis progress.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { homeFixture, sessionPayloadFixture, trainTodayFixture } from "@repo/contracts/http/fixtures/p05";
import { reviewStatusFixture } from "@repo/contracts/http/fixtures/review";
import type { HomeData } from "@repo/contracts/http/home";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import type { Badges } from "@repo/contracts/http/train";
import { analysisEventFixtures } from "@repo/contracts/socket/fixtures/analysis";
import { userEventFixtures } from "@repo/contracts/socket/fixtures/user";
import { qk } from "@/lib/api/keys";
import { cancelThrottledInvalidations } from "../invalidateThrottled";
import { RESYNC_QUERY_KEYS } from "../resync";
import { applyHomeEvent, homeOnAnalysisProgress, homeOnImportProgress } from "./home";
import { applyBankAdded, applyBankDue, applyTrainEvent, markStale, TRAIN_INVALIDATE_KEYS } from "./train";

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData<Badges>(qk.badges(), { bankDue: 9, trainDot: true });
  qc.setQueryData(qk.me(), { user: { ref: "cme" }, badges: { bankDue: 9, trainDot: true } });
  qc.setQueryData<HomeData>(qk.home(), homeFixture("populated"));
  qc.setQueryData(qk.train.today(), trainTodayFixture("default"));
  qc.setQueryData(qk.train.session("cm5t9s3ss0001slzpbankdrl1"), sessionPayloadFixture("bank"));
  return qc;
}

function recorder() {
  const keys: QueryKey[] = [];
  return { keys, invalidate: (_qc: QueryClient, key: QueryKey) => void keys.push(key) };
}

describe("train handler: due counts", () => {
  it("bank:due_changed writes bankDue into badges, me.badges and home.bank.due, then invalidates train + home", () => {
    const qc = seeded();
    const rec = recorder();
    applyTrainEvent(qc, "bank:due_changed", userEventFixtures()["bank:due_changed"], rec.invalidate);
    assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 4);
    assert.equal((qc.getQueryData(qk.me()) as { badges: Badges }).badges.bankDue, 4);
    assert.equal(qc.getQueryData<HomeData>(qk.home())?.bank.due, 4);
    assert.deepEqual(rec.keys, [...TRAIN_INVALIDATE_KEYS]);
  });

  it("mistakes:added does the same and never touches an open review", () => {
    const qc = seeded();
    qc.setQueryData(qk.review.status("cm3k9x2p10007slzpqa8hd4fe"), reviewStatusFixture("done"));
    const rec = recorder();
    applyTrainEvent(qc, "mistakes:added", userEventFixtures()["mistakes:added"], rec.invalidate);
    assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 9);
    assert.equal(qc.getQueryData<ReviewStatusDTO>(qk.review.status("cm3k9x2p10007slzpqa8hd4fe"))?.bank, null);
    assert.equal(rec.keys.length, TRAIN_INVALIDATE_KEYS.length);
  });

  it("analysis:done with bank fields patches A2's bank and the counts; a P3 frame without them changes nothing", () => {
    const qc = seeded();
    const done = analysisEventFixtures()["analysis:done"];
    qc.setQueryData(qk.review.status(done.gameRef), reviewStatusFixture("done"));
    const rec = recorder();
    applyTrainEvent(qc, "analysis:done", done, rec.invalidate);
    assert.deepEqual(qc.getQueryData<ReviewStatusDTO>(qk.review.status(done.gameRef))?.bank, { count: 3, plies: [24, 36, 46] });
    assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 4);
    assert.equal(rec.keys.length, TRAIN_INVALIDATE_KEYS.length);

    const qc2 = seeded();
    const rec2 = recorder();
    const p3Frame: Record<string, unknown> = { ...done };
    delete p3Frame.bankAdded;
    delete p3Frame.bankDue;
    applyTrainEvent(qc2, "analysis:done", p3Frame as typeof done, rec2.invalidate);
    assert.equal(qc2.getQueryData<Badges>(qk.badges())?.bankDue, 9);
    assert.deepEqual(rec2.keys, [], "no bank fields → no train/home invalidation from this handler");
  });

  it("a lost batch response (bankAdded null, bankDue null): counts kept, A2 refetched (not overwritten), keys invalidated", () => {
    const qc = seeded();
    const done = { ...analysisEventFixtures()["analysis:done"], bankAdded: null, bankDue: null };
    qc.setQueryData(qk.review.status(done.gameRef), { ...reviewStatusFixture("done"), bank: { count: 1, plies: [24] } });
    const rec = recorder();
    applyTrainEvent(qc, "analysis:done", done, rec.invalidate);
    assert.deepEqual(qc.getQueryData<ReviewStatusDTO>(qk.review.status(done.gameRef))?.bank, { count: 1, plies: [24] });
    assert.equal(qc.getQueryState(qk.review.status(done.gameRef))?.isInvalidated, true, "falls back to A2");
    assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 9);
    assert.equal(rec.keys.length, TRAIN_INVALIDATE_KEYS.length);
  });

  it("analysis:batch's bankDue reaches the counts", () => {
    const qc = seeded();
    applyTrainEvent(qc, "analysis:batch", analysisEventFixtures()["analysis:batch"], recorder().invalidate);
    assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 6);
  });

  it("applyBankDue reports no change when nothing is cached or the count is the same", () => {
    assert.equal(applyBankDue(new QueryClient(), 3), false);
    const qc = seeded();
    assert.equal(applyBankDue(qc, 2), true);
    assert.equal(applyBankDue(qc, 2), false, "every cache already shows 2");
  });

  it("applyBankAdded ignores a game whose status is not cached", () => {
    assert.equal(applyBankAdded(new QueryClient(), analysisEventFixtures()["analysis:done"]), false);
  });

  it("markStale invalidates without fetching", async () => {
    const qc = seeded();
    markStale(qc, qk.train.today());
    assert.equal(qc.getQueryState(qk.train.today())?.isInvalidated, true);
  });

  it("the invalidated keys are today's plan, every bank list and Home: never a session payload", () => {
    assert.deepEqual(TRAIN_INVALIDATE_KEYS, [qk.train.today(), ["train", "bank"], qk.home()]);
    const qc = seeded();
    qc.setQueryData(qk.train.bank({ view: "due", theme: "fork" }), { pages: [], pageParams: [] });
    for (const key of TRAIN_INVALIDATE_KEYS) markStale(qc, key);
    assert.equal(qc.getQueryState(qk.train.bank({ view: "due", theme: "fork" }))?.isInvalidated, true, "a filtered bank list");
    assert.equal(qc.getQueryState(qk.train.session("cm5t9s3ss0001slzpbankdrl1"))?.isInvalidated, false, "the runner's payload");
  });

  it("without an injected invalidator, a burst of events invalidates each key once per 30 s window", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const qc = seeded();
      const spy = mock.method(qc, "invalidateQueries", async () => {});
      const frame = userEventFixtures()["bank:due_changed"];
      for (let i = 0; i < 50; i++) applyTrainEvent(qc, "bank:due_changed", { ...frame, bankDue: i });
      assert.equal(spy.mock.callCount(), 0, "nothing before the window ends");
      assert.equal(qc.getQueryData<Badges>(qk.badges())?.bankDue, 49, "the counts are written at once");
      mock.timers.tick(30_000);
      assert.deepEqual(
        spy.mock.calls.map((c) => (c.arguments[0] as { queryKey: unknown }).queryKey),
        [...TRAIN_INVALIDATE_KEYS],
      );
      cancelThrottledInvalidations(qc);
    } finally {
      mock.timers.reset();
      mock.restoreAll();
    }
  });

  it("the P5 keys are on the reconnect resync list", () => {
    for (const key of [qk.train.all(), qk.home(), qk.badges()]) {
      assert.ok(RESYNC_QUERY_KEYS.some((k) => JSON.stringify(k) === JSON.stringify(key)), JSON.stringify(key));
    }
  });
});

describe("home handler", () => {
  it("import:progress patches the status row (never backwards, other provider ignored)", () => {
    const d = homeFixture("import_running");
    const ev = { ...userEventFixtures()["import:progress"], imported: 300 };
    assert.equal(homeOnImportProgress(d, ev).import?.imported, 300);
    assert.equal(homeOnImportProgress(d, { ...ev, imported: 100 }).import?.imported, 212);
    assert.equal(homeOnImportProgress(d, { ...ev, provider: "lichess" }), d);
    const populated = homeFixture("populated");
    assert.equal(homeOnImportProgress(populated, ev), populated, "no import row → unchanged");
  });

  it("analysis:progress moves the Continue card's counter for that game only", () => {
    const d = homeFixture("analysing");
    const ev = { ...analysisEventFixtures()["analysis:progress"], gameRef: d.continue!.gameRef, gradedPlies: 20, totalPlies: 38 };
    assert.deepEqual(homeOnAnalysisProgress(d, ev).continue?.analysis, { status: "running", done: 20, total: 38 });
    assert.equal(homeOnAnalysisProgress(d, { ...ev, gameRef: "cm0ther0game0slzpaaaaaaaa1" }), d);
    assert.equal(homeOnAnalysisProgress(homeFixture("populated"), ev).continue?.kind, "moments");
  });

  it("applyHomeEvent: patches without a fetch, invalidates on the terminal events, no-ops without a cache", () => {
    const qc = new QueryClient();
    const rec = recorder();
    applyHomeEvent(qc, "import:progress", userEventFixtures()["import:progress"], rec.invalidate);
    assert.equal(qc.getQueryData(qk.home()), undefined);
    qc.setQueryData<HomeData>(qk.home(), homeFixture("import_running"));
    applyHomeEvent(qc, "import:progress", { ...userEventFixtures()["import:progress"], imported: 250 }, rec.invalidate);
    assert.equal(qc.getQueryData<HomeData>(qk.home())?.import?.imported, 250);
    assert.deepEqual(rec.keys, []);
    applyHomeEvent(qc, "import:finished", userEventFixtures()["import:finished"], rec.invalidate);
    assert.deepEqual(rec.keys, [qk.home()]);
  });
});
