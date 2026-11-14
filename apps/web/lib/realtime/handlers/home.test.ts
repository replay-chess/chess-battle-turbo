// Home's user-room handler (phase-05 plan §4.1 transitions, §5.5; api-perf AP-10): import and analysis progress patch
// the cache with no fetch; analysis:done of the analysing Continue game refetches at once; every other Home event
// goes through the throttled invalidator (one trailing refetch per 30 s; a hidden tab only marks the key stale).
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { homeFixture } from "@repo/contracts/http/fixtures/p05";
import type { HomeData } from "@repo/contracts/http/home";
import { qk } from "@/lib/api/keys";
import { cancelThrottledInvalidations, pendingInvalidations, PUSH_INVALIDATE_MS } from "../invalidateThrottled";
import { applyHomeEvent, finishesContinue, homeInvalidator, homeRefetchInvalidator } from "./home";

function recorder() {
  const keys: QueryKey[] = [];
  return { keys, invalidate: (_qc: QueryClient, key: QueryKey) => void keys.push(key) };
}

describe("home handler", () => {
  afterEach(() => mock.timers.reset());

  it("analysis:done of the Continue game being analysed refetches Home now, not through the throttle", () => {
    const qc = new QueryClient();
    const d = homeFixture("analysing");
    qc.setQueryData<HomeData>(qk.home(), d);
    const spy = mock.method(qc, "invalidateQueries");
    const rec = recorder();
    applyHomeEvent(qc, "analysis:done", { gameRef: d.continue!.gameRef }, rec.invalidate);
    assert.equal(rec.keys.length, 0, "not throttled");
    assert.equal(spy.mock.callCount(), 1);
    assert.deepEqual((spy.mock.calls[0]!.arguments[0] as { queryKey: QueryKey }).queryKey, qk.home());
  });

  it("analysis:done of another game, analysis:batch and import:finished go through the invalidator", () => {
    const qc = new QueryClient();
    qc.setQueryData<HomeData>(qk.home(), homeFixture("analysing"));
    const rec = recorder();
    applyHomeEvent(qc, "analysis:done", { gameRef: "cm0other0000000000000000" }, rec.invalidate);
    applyHomeEvent(qc, "analysis:batch", { v: 1, done: 3, total: 9 }, rec.invalidate);
    applyHomeEvent(qc, "import:finished", {}, rec.invalidate);
    assert.deepEqual(rec.keys, [qk.home(), qk.home(), qk.home()]);
  });

  it("finishesContinue only for an analysing Continue card of that game", () => {
    const a = homeFixture("analysing");
    assert.equal(finishesContinue(a, { gameRef: a.continue!.gameRef }), true);
    assert.equal(finishesContinue(a, { gameRef: "x" }), false);
    assert.equal(finishesContinue(homeFixture("populated"), { gameRef: a.continue!.gameRef }), false);
    assert.equal(finishesContinue(homeFixture("new_user"), { gameRef: a.continue!.gameRef }), false);
    assert.equal(finishesContinue(undefined, { gameRef: a.continue!.gameRef }), false);
  });

  it("the default invalidator coalesces a backlog burst into one trailing invalidation per 30 s", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const qc = new QueryClient();
    qc.setQueryData<HomeData>(qk.home(), homeFixture("populated"));
    const spy = mock.method(qc, "invalidateQueries");
    for (let i = 0; i < 100; i += 1) applyHomeEvent(qc, "analysis:batch", { v: 1, done: i, total: 500 }, homeInvalidator);
    assert.equal(pendingInvalidations(qc), 1);
    assert.equal(spy.mock.callCount(), 0, "nothing before the window ends");
    mock.timers.tick(PUSH_INVALIDATE_MS);
    assert.equal(spy.mock.callCount(), 1);
    assert.deepEqual((spy.mock.calls[0]!.arguments[0] as { queryKey: QueryKey }).queryKey, qk.home());
    cancelThrottledInvalidations(qc);
  });

  it("FIX-2 (§10.2): home.refetch{cause} counts the refetches Home opens, by event; frames joining a window are not counted", () => {
    const qc = new QueryClient();
    const d = homeFixture("analysing");
    qc.setQueryData<HomeData>(qk.home(), d);
    const causes: string[] = [];
    const report = (c: string) => void causes.push(c);
    applyHomeEvent(qc, "analysis:batch", { v: 1, done: 1, total: 9 }, homeRefetchInvalidator("analysis:batch", report), report);
    applyHomeEvent(qc, "analysis:batch", { v: 1, done: 2, total: 9 }, homeRefetchInvalidator("analysis:batch", report), report);
    applyHomeEvent(qc, "import:finished", {}, homeRefetchInvalidator("import:finished", report), report);
    assert.deepEqual(causes, ["analysis:batch"], "one window, one refetch");
    applyHomeEvent(qc, "analysis:done", { gameRef: d.continue!.gameRef }, homeRefetchInvalidator("analysis:done", report), report);
    assert.deepEqual(causes, ["analysis:batch", "analysis:done"], "the immediate Continue swap counts too");
    cancelThrottledInvalidations(qc);
  });
});
