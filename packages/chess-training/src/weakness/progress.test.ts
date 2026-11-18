// Progress and ETA (phase-06 plan §8.13, §12.1): the weights, the step states, the ETA text thresholds, `stalled` at
// 10 minutes with a fixed now, N capped at 100 (member) and 20 (trial), `orphaned`, and the event patch.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WeaknessProgress } from "@repo/contracts/http/weakness";
import { analysingTarget, computeProgress, etaText, progressFromEvent, type ProgressInput } from "./progress";

const NOW = new Date("2026-11-17T09:30:00.000Z");
const base: ProgressInput = {
  analysedInScope: 0,
  inScope: 60,
  isTrialing: false,
  importRunning: false,
  importDone: 0,
  importTotal: 0,
  importRatePerSec: null,
  recompute: "none",
  hasReady: false,
  snapshot: false,
  activeAnalyzeJobs: 0,
  lastAnalysedAt: null,
  secPerGame: 40,
  lanes: 1,
  queueAheadSec: 0,
  bandLabel: "1100–1300",
};
const p = (o: Partial<ProgressInput>) => computeProgress({ ...base, ...o }, NOW);

describe("computeProgress", () => {
  it("weights the steps 15/70/10/5: an import at 50 % adds 7.5 points", () => {
    const r = p({ importRunning: true, importDone: 106, importTotal: 212, importRatePerSec: 4 });
    assert.equal(r.steps[0]!.pct, 50);
    assert.equal(r.pct, Math.round(0.15 * 50));
    assert.equal(p({ analysedInScope: 10 }).pct, Math.round(0.15 * 100 + 0.7 * 50));
    assert.equal(p({ analysedInScope: 20, recompute: "running" }).pct, Math.round(15 + 70 + 5));
    assert.equal(p({ analysedInScope: 20, recompute: "queued" }).pct, Math.round(15 + 70 + 1));
    assert.equal(p({ analysedInScope: 25, hasReady: true }).pct, 100);
    assert.ok(WeaknessProgress.safeParse(p({ analysedInScope: 9 })).success);
  });

  it("marks done / run / wait and labels the steps (band or 'your level'; import count or in-scope)", () => {
    const r = p({ analysedInScope: 9 });
    assert.deepEqual(r.steps.map((s) => s.state), ["done", "run", "wait", "wait"]);
    assert.deepEqual(r.steps.map((s) => s.label), ["Import 60 games", "Grade every move with Stockfish", "Find patterns across games", "Compare with players rated 1100–1300"]);
    assert.equal(p({ bandLabel: null }).steps[3]!.label, "Compare with players at your level");
    assert.equal(p({ importRunning: true, importDone: 10, importTotal: 480, importRatePerSec: 2 }).steps[0]!.label, "Import 480 games");
    assert.deepEqual(p({ analysedInScope: 20, recompute: "running" }).steps.map((s) => s.state), ["done", "done", "run", "wait"]);
  });

  it("ETA: (20 − analysed) × sec/game / lanes + import remainder / rate + queue + 5 s; unknown import rate → null", () => {
    assert.equal(p({ analysedInScope: 5 }).etaSec, 15 * 40 + 5);
    assert.equal(p({ analysedInScope: 5, lanes: 2 }).etaSec, 15 * 20 + 5);
    assert.equal(p({ analysedInScope: 5, importRunning: true, importDone: 100, importTotal: 200, importRatePerSec: 4 }).etaSec, 15 * 40 + 25 + 5);
    assert.equal(p({ analysedInScope: 5, importRunning: true, importDone: 100, importTotal: 200, importRatePerSec: null }).etaSec, null);
    assert.equal(p({ analysedInScope: 5, queueAheadSec: 120 }).etaSec, 15 * 40 + 125);
    assert.equal(p({ analysedInScope: 0, secPerGame: null }).etaSec, 20 * 45 + 5, "the 45 s fallback");
  });

  it("ETA text thresholds (89 s, 90 s, 89 min, 90 min, null)", () => {
    assert.equal(etaText(89), "about a minute left");
    assert.equal(etaText(90), "about 2 minutes left");
    assert.equal(etaText(13 * 60), "about 13 minutes left");
    assert.equal(etaText(89 * 60), "about 89 minutes left");
    assert.equal(etaText(90 * 60), "about 2 hours left");
    assert.equal(etaText(null), "Working…");
  });

  it("stalled after 10 minutes without an analysis while jobs are active", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    assert.equal(p({ activeAnalyzeJobs: 3, lastAnalysedAt: at(600_000) }).stalled, false);
    assert.equal(p({ activeAnalyzeJobs: 3, lastAnalysedAt: at(600_001) }).stalled, true);
    assert.equal(p({ activeAnalyzeJobs: 0, lastAnalysedAt: at(3_600_000) }).stalled, false);
  });

  it("caps N at 100 for a member and 20 for a trialist", () => {
    assert.deepEqual(analysingTarget(212, false), { n: 100, capped: true });
    assert.deepEqual(analysingTarget(212, true), { n: 20, capped: true });
    assert.deepEqual(analysingTarget(60, false), { n: 60, capped: false });
    assert.deepEqual(analysingTarget(0, false), { n: 1, capped: false });
    assert.equal(p({ inScope: 212 }).target, 100);
    assert.equal(p({ inScope: 212, isTrialing: true }).target, 20);
  });

  it("orphaned: ≥ 5 analysed, no snapshot, no recompute", () => {
    assert.equal(p({ analysedInScope: 5 }).orphaned, true);
    assert.equal(p({ analysedInScope: 4 }).orphaned, false);
    assert.equal(p({ analysedInScope: 22, snapshot: true }).orphaned, false);
    assert.equal(p({ analysedInScope: 22, recompute: "queued" }).orphaned, false);
  });
});

describe("progressFromEvent", () => {
  it("patches the cached block from a weakness:progress frame, keeping the band label", () => {
    const prev = p({ analysedInScope: 4 });
    const next = progressFromEvent({ v: 1, pct: 47, step: "grade", etaSec: 495, stalled: false, analysed: 9, target: 100, importDone: 212, importTotal: 212 }, prev);
    assert.ok(WeaknessProgress.safeParse(next).success);
    assert.equal(next.pct, 47);
    assert.equal(next.analysed, 9);
    assert.equal(next.steps[1]!.pct, 45);
    assert.deepEqual(next.steps.map((s) => s.state), ["done", "run", "wait", "wait"]);
    assert.equal(next.steps[3]!.label, "Compare with players rated 1100–1300");
    assert.equal(next.orphaned, false);
    const importing = progressFromEvent({ v: 1, pct: 8, step: "import", etaSec: null, stalled: false, analysed: 0, target: 100, importDone: 120, importTotal: 480 }, null);
    assert.equal(importing.steps[0]!.pct, 25);
    assert.equal(importing.steps[0]!.label, "Import 480 games");
    assert.equal(importing.steps[0]!.state, "run");
  });
});
