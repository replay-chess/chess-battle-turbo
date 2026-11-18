// deriveStatus (phase-06 plan §8.14, §12.1): every branch; READY + recompute → updating; FAILED + no job → failed;
// FAILED + queued → computing; 20 analysed without a snapshot → computing with `orphaned`; an import → computing;
// 19 in scope → insufficient; the bullet offer.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveStatus, type StatusInput } from "./status";

const base: StatusInput = { snapshot: null, recompute: "none", lastJobFailed: false, importRunning: false, analysedInScope: 0, inScope: 0 };
const s = (o: Partial<StatusInput>) => deriveStatus({ ...base, ...o });

describe("deriveStatus", () => {
  it("READY wins; a pending recompute adds `updating` with the new analysed games", () => {
    const snap = { status: "READY" as const, gamesAnalysed: 40 };
    assert.deepEqual(s({ snapshot: snap, analysedInScope: 44 }), { status: "ready", updating: null, orphaned: false, offerBullet: false, paused: false });
    assert.deepEqual(s({ snapshot: snap, analysedInScope: 44, recompute: "queued" }).updating, { newGames: 4 });
    assert.deepEqual(s({ snapshot: snap, analysedInScope: 38, recompute: "running" }).updating, { newGames: 0 });
    assert.equal(s({ snapshot: snap, lastJobFailed: true }).status, "ready", "a failure never hides a good profile");
  });

  it("FAILED (row or job) without a pending job → failed; with one → computing", () => {
    assert.equal(s({ snapshot: { status: "FAILED", gamesAnalysed: 22 }, analysedInScope: 22 }).status, "failed");
    assert.equal(s({ lastJobFailed: true, analysedInScope: 22 }).status, "failed");
    assert.equal(s({ snapshot: { status: "FAILED", gamesAnalysed: 22 }, analysedInScope: 22, recompute: "queued" }).status, "computing");
    assert.equal(s({ snapshot: { status: "FAILED", gamesAnalysed: 22 }, analysedInScope: 22, recompute: "running" }).status, "computing");
  });

  it("20 analysed without a snapshot → computing and orphaned (the page auto-builds); with a job → not orphaned", () => {
    assert.deepEqual(s({ analysedInScope: 20, inScope: 20 }), { status: "computing", updating: null, orphaned: true, offerBullet: false, paused: false });
    assert.equal(s({ analysedInScope: 22, inScope: 25, recompute: "queued" }).orphaned, false);
    assert.equal(s({ analysedInScope: 22, inScope: 25, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 19 } }).orphaned, true, "stuck INSUFFICIENT row");
  });

  it("an import or ≥ 20 in scope → computing (grade step)", () => {
    assert.equal(s({ importRunning: true, analysedInScope: 3, inScope: 10 }).status, "computing");
    assert.equal(s({ analysedInScope: 12, inScope: 25 }).status, "computing");
    assert.equal(s({ analysedInScope: 12, inScope: 25, activeAnalyzeJobs: 3 }).status, "computing");
    assert.equal(s({ analysedInScope: 12, inScope: 25, activeAnalyzeJobs: 0, recompute: "queued" }).status, "computing");
  });

  it("regression: weakness-computing-forever — ≥ 20 in scope but nothing analysing, importing or recomputing → insufficient", () => {
    // The review's trialist: 24 in scope, 18 analysed (the rest too short or failed), no job: never "computing" for good.
    const r = s({ analysedInScope: 18, inScope: 24, activeAnalyzeJobs: 0, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 18 } });
    assert.deepEqual(r, { status: "insufficient", updating: null, orphaned: false, offerBullet: false, paused: false });
    // Without an INSUFFICIENT row the page still auto-builds one (orphaned), and shows insufficient meanwhile.
    assert.deepEqual(s({ analysedInScope: 18, inScope: 24, activeAnalyzeJobs: 0 }).orphaned, true);
  });

  it("regression: weakness-killswitch-loop — the kill switch skipped the build: failed (paused), never orphaned", () => {
    assert.deepEqual(s({ analysedInScope: 22, inScope: 25, activeAnalyzeJobs: 0, paused: true }), { status: "failed", updating: null, orphaned: false, offerBullet: false, paused: true });
    assert.equal(s({ analysedInScope: 12, inScope: 12, paused: true }).status, "failed");
    assert.equal(s({ analysedInScope: 2, inScope: 3, paused: true }).status, "insufficient", "few games: still ask for games");
    assert.equal(s({ analysedInScope: 22, inScope: 25, paused: true, recompute: "queued" }).status, "computing", "re-armed: it may run");
    assert.equal(s({ snapshot: { status: "READY", gamesAnalysed: 22 }, analysedInScope: 22, paused: true }).status, "ready", "the profile stays");
  });

  it("19 in scope → insufficient; 5..19 analysed without a snapshot is orphaned (the auto-build writes INSUFFICIENT)", () => {
    assert.deepEqual(s({ analysedInScope: 4, inScope: 19 }), { status: "insufficient", updating: null, orphaned: false, offerBullet: false, paused: false });
    assert.equal(s({ analysedInScope: 14, inScope: 19 }).orphaned, true);
    assert.equal(s({ analysedInScope: 14, inScope: 19, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 14 } }).orphaned, false);
  });

  it("offers bullet games when they would fill the gap and the scope has none", () => {
    assert.equal(s({ analysedInScope: 8, inScope: 8, bulletGames: 64 }).offerBullet, true);
    assert.equal(s({ analysedInScope: 8, inScope: 8, bulletGames: 11 }).offerBullet, false, "12 needed");
    assert.equal(s({ analysedInScope: 8, inScope: 8, bulletGames: 12 }).offerBullet, true);
    assert.equal(s({ analysedInScope: 8, inScope: 8, bulletGames: 64, scopeHasBullet: true }).offerBullet, false);
    assert.equal(s({ analysedInScope: 8, inScope: 25, bulletGames: 64 }).offerBullet, false, "computing");
  });

  it("regression: weakness-count-drift — an INSUFFICIENT snapshot that already counted these games is not rebuilt (FIX-2)", () => {
    // The page now counts exactly the worker's set (the newest 300 in scope, inputs usable): 18 live = 18 in the row.
    const settled = s({ analysedInScope: 18, inScope: 600, activeAnalyzeJobs: 0, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 18 } });
    assert.deepEqual(settled, { status: "insufficient", updating: null, orphaned: false, offerBullet: false, paused: false });
    // Games analysed since the row (22 > 12): computing, and the page builds once.
    const fresh = s({ analysedInScope: 22, inScope: 600, activeAnalyzeJobs: 0, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 12 } });
    assert.deepEqual([fresh.status, fresh.orphaned], ["computing", true]);
    // Not more than the row counted (a count can only fall: a purge, a heal that failed): never computing for good.
    const fallen = s({ analysedInScope: 20, inScope: 600, activeAnalyzeJobs: 0, snapshot: { status: "INSUFFICIENT", gamesAnalysed: 20 } });
    assert.equal(fallen.orphaned, false);
    assert.notEqual(fallen.status, "computing");
  });
});

