// The weakness page's view state (phase-06 plan §4.2, §5.3): one open row, See all, the tab, the ready flash.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { initialViewState, viewReducer } from "./view-state";

describe("weakness view state", () => {
  it("row 0 open by default; one open at a time; toggling the open row closes it", () => {
    let s = initialViewState("phase", "ready");
    assert.equal(s.openIndex, 0);
    s = viewReducer(s, { type: "toggleRow", index: 2 });
    assert.equal(s.openIndex, 2);
    s = viewReducer(s, { type: "toggleRow", index: 2 });
    assert.equal(s.openIndex, -1);
  });

  it("Show fewer closes an open row 4 or 5", () => {
    let s = viewReducer(initialViewState("phase", "ready"), { type: "toggleShowAll" });
    s = viewReducer(s, { type: "toggleRow", index: 4 });
    s = viewReducer(s, { type: "toggleShowAll" });
    assert.deepEqual([s.showAll, s.openIndex], [false, -1]);
    s = viewReducer(viewReducer(s, { type: "toggleRow", index: 1 }), { type: "toggleShowAll" });
    s = viewReducer(s, { type: "toggleShowAll" });
    assert.equal(s.openIndex, 1, "rows 1–3 stay open");
  });

  it("the tab; the same tab returns the same object (no re-render)", () => {
    const s = initialViewState("open", "ready");
    assert.equal(s.tab, "open");
    assert.equal(viewReducer(s, { type: "setTab", tab: "open" }), s);
    assert.equal(viewReducer(s, { type: "setTab", tab: "clock" }).tab, "clock");
  });

  it("the ready flash shows only after this mount watched computing", () => {
    let s = initialViewState("phase", "computing");
    assert.equal(s.sawComputing, true);
    s = viewReducer(s, { type: "status", status: "ready" });
    assert.deepEqual([s.flash, s.sawComputing], [true, false]);
    s = viewReducer(s, { type: "dismissFlash" });
    assert.equal(s.flash, false);
    const direct = viewReducer(initialViewState("phase", "ready"), { type: "status", status: "ready" });
    assert.equal(direct.flash, false, "a profile that was ready on arrival has no flash");
    let viaInsufficient = viewReducer(initialViewState("phase", "insufficient"), { type: "status", status: "computing" });
    viaInsufficient = viewReducer(viaInsufficient, { type: "status", status: "failed" });
    assert.deepEqual([viaInsufficient.flash, viaInsufficient.sawComputing], [false, false]);
  });

  it("regression: weakness-flash-over-failed (P6 WP8) — a status that is not ready clears the ready flash", () => {
    // A retry's build turned ready (the flash) and the next recompute failed before the member dismissed it: the
    // weakness:ready {status: failed} refetch must show the failed state, not "Your profile is ready".
    let s = initialViewState("phase", "failed");
    s = viewReducer(s, { type: "status", status: "computing" });
    s = viewReducer(s, { type: "status", status: "ready" });
    assert.equal(s.flash, true);
    const failed = viewReducer(s, { type: "status", status: "failed" });
    assert.equal(failed.flash, false);
    assert.equal(failed.sawComputing, false);
    const insufficient = viewReducer(s, { type: "status", status: "insufficient" });
    assert.equal(insufficient.flash, false);
  });

  it("pushed", () => {
    const s = initialViewState("phase", "ready");
    assert.equal(viewReducer(s, { type: "pushed", pushed: false }), s);
    assert.equal(viewReducer(s, { type: "pushed", pushed: true }).pushed, true);
  });
});
