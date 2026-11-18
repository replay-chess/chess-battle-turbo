// buildPayload (phase-06 plan §7.1.1 step 5, §7.2, §4.4–4.8): every page status from a snapshot plus the live probe,
// each parsed with the TR-5 contract: insufficient (zero, few, preliminary, the bullet offer), computing (progress,
// ETA, orphaned auto-build), ready (+ updating), failed, most_frequent, no band, no clock; the snapshot key and the
// versions; and that nothing is computed from data the payload must not carry.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WeaknessPayload } from "@repo/contracts/http/weakness";
import { loadBaseline } from "../../baselines/load";
import { err, fromJson, gameInput, type GameSpec } from "../../test/gen";
import { buildMemberDesign } from "../../test/member-design";
import { computeWeakness, failedMetrics } from "./compute";
import { buildPayload, type PayloadInput, weaknessSnapshotKey } from "./payload";
import { resolveScope } from "./scope";
import type { WeaknessGameInput } from "./types";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const TZ = "Europe/London";
const baseline = loadBaseline("v0-synthetic");
const noJobs: PayloadInput["probe"] = { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, games: [], importRun: null, lastAnalysedAt: null };

function input(o: Partial<PayloadInput>): PayloadInput {
  return { now: NOW, timeZone: TZ, snapshot: null, profile: null, inBank: {}, probe: noJobs, isTrialing: false, secPerGame: 45, lanes: 1, ...o };
}

function parsed(i: PayloadInput) {
  const p = buildPayload(i);
  const r = WeaknessPayload.safeParse(p);
  assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  return p;
}

function snapshotOf(games: WeaknessGameInput[], computedAt = NOW) {
  const d = computeWeakness(games, baseline, { now: computedAt, timeZone: TZ, profile: null, ratingBand: null });
  return { weekStart: "2026-11-16", algoVersion: 1, status: d.status, gamesInScope: d.gamesInScope, gamesAnalysed: d.gamesAnalysed, metrics: d.metrics, computedAt };
}

function games(n: number, f: (i: number) => Partial<GameSpec> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    gameInput({ gameId: String(1 + i), color: "w", endedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000), errors: [err(i % 2 ? ["fork"] : ["hangingPiece"]), err(["fork"])], ...f(i) }),
  );
}

describe("buildPayload: insufficient", () => {
  it("zero: no games, 'Rapid and blitz · since May 2026', no preliminary, no progress", () => {
    const p = parsed(input({}));
    assert.equal(p.status, "insufficient");
    assert.equal(p.scopeLabel, "Rapid and blitz · since May 2026");
    assert.deepEqual(p.games, { analysed: 0, inScope: 0, pending: 1, required: 20, preliminaryFrom: 5 });
    assert.equal(p.progress, null);
    assert.deepEqual(p.preliminary, []);
    assert.equal(p.snapshotKey, null);
    assert.equal(p.computedAt, null);
  });

  it("preliminary: 14 analysed with an INSUFFICIENT snapshot lists 'Seen in 5 of 14 games'", () => {
    const g = games(14, (i) => ({ errors: i < 5 ? [err(["fork"]), err(["fork"])] : i < 8 ? [err(["hangingPiece"])] : [] }));
    const snap = snapshotOf(g);
    assert.equal(snap.status, "INSUFFICIENT");
    const p = parsed(input({ snapshot: snap, probe: { ...noJobs, games: [{ timeClass: "BLITZ", n: 14, analysed: 14 }] } }));
    assert.equal(p.status, "insufficient");
    assert.deepEqual(p.preliminary, [
      { pattern: "fork", label: "Missed forks", seenIn: 5, of: 14 },
      { pattern: "hangingPiece", label: "Missed free pieces", seenIn: 3, of: 14 },
    ]);
    assert.equal(p.games.analysed, 14);
    assert.equal(p.headline, null);
    assert.equal(p.breakdown, null);
  });

  it("offers bullet games that would fill the gap", () => {
    const p = parsed(input({ probe: { ...noJobs, games: [{ timeClass: "BLITZ", n: 8, analysed: 8 }, { timeClass: "BULLET", n: 64, analysed: 40 }] } }));
    assert.deepEqual(p.offers, { includeBullet: { bulletGames: 64 } });
    assert.equal(p.games.inScope, 8, "bullet games are not in the default scope");
  });
});

describe("buildPayload: computing", () => {
  it("an import: progress with steps, an ETA, 'Analysing 60 games'", () => {
    const p = parsed(
      input({
        probe: { ...noJobs, activeAnalyzeJobs: 20, games: [{ timeClass: "BLITZ", n: 40, analysed: 4 }, { timeClass: "RAPID", n: 20, analysed: 0 }], importRun: { done: 60, total: 60, ratePerSec: null } },
      }),
    );
    assert.equal(p.status, "computing");
    assert.equal(p.progress!.target, 60);
    assert.equal(p.progress!.analysed, 4);
    assert.equal(p.progress!.etaSec, null, "import rate unknown");
    assert.equal(p.games.pending, 56);
  });

  it("20 analysed, no snapshot, no job: orphaned (the page sends one auto-build)", () => {
    const p = parsed(input({ probe: { ...noJobs, games: [{ timeClass: "BLITZ", n: 22, analysed: 22 }] } }));
    assert.equal(p.status, "computing");
    assert.equal(p.progress!.orphaned, true);
    const queued = parsed(input({ probe: { ...noJobs, recompute: "queued", games: [{ timeClass: "BLITZ", n: 22, analysed: 22 }] } }));
    assert.equal(queued.progress!.orphaned, false);
    assert.equal(queued.progress!.steps[2]!.state, "run");
  });

  it("7 analysed, no snapshot, no job: insufficient but orphaned (the auto-build writes the INSUFFICIENT row)", () => {
    const p = parsed(input({ probe: { ...noJobs, games: [{ timeClass: "RAPID", n: 7, analysed: 7 }] } }));
    assert.equal(p.status, "insufficient");
    assert.equal(p.progress!.orphaned, true);
  });
});

describe("buildPayload: ready, updating, failed", () => {
  const md = buildMemberDesign();
  const design = snapshotOf(md.games.map(fromJson));

  it("ready: rows, versions, the snapshot key; updating while a recompute is pending", () => {
    const profile = { weaknessTimeClasses: [], weaknessMonths: 0, puzzleRating: 1512, weaknessVersion: 3, lastWeaknessSeenVersion: 2 };
    const p = parsed(input({ snapshot: design, profile, inBank: md.live.inBank }));
    assert.equal(p.status, "ready");
    assert.equal(p.version, 3);
    assert.equal(p.seenVersion, 2);
    assert.equal(p.snapshotKey, weaknessSnapshotKey("2026-11-16", NOW));
    assert.equal(p.snapshotKey, `2026-11-16.${NOW.getTime().toString(36)}`);
    assert.equal(p.updating, null);
    const upd = parsed(input({ snapshot: design, profile, probe: { ...noJobs, recompute: "queued", games: [{ timeClass: "BLITZ", n: 130, analysed: 130 }, { timeClass: "RAPID", n: 86, analysed: 86 }] } }));
    assert.deepEqual(upd.updating, { newGames: 4 });
    assert.equal(upd.scopeLabel, "212 games · rapid and blitz · since Aug 2026", "the shown profile's own scope");
  });

  it("failed: a FAILED row and no job; Retry is retryable", () => {
    const scope = resolveScope(null);
    const metrics = failedMetrics({ code: "compute_error", at: NOW, scope, since: new Date("2026-05-01T00:00:00Z"), inScope: 22, analysed: 22, baseline });
    const p = parsed(input({ snapshot: { weekStart: "2026-11-16", algoVersion: 1, status: "FAILED", gamesInScope: 22, gamesAnalysed: 22, metrics, computedAt: NOW }, probe: { ...noJobs, games: [{ timeClass: "BLITZ", n: 22, analysed: 22 }] } }));
    assert.equal(p.status, "failed");
    assert.deepEqual(p.failure, { code: "compute_error", retryable: true });
    assert.equal(p.progress, null);
  });

  it("no band (no ratings, no onboarding band): own_only rows without band numbers", () => {
    const g = md.games.map(fromJson).map((x) => ({ ...x, ratingBefore: null }));
    const p = parsed(input({ snapshot: snapshotOf(g) }));
    assert.equal(p.listMode, "own_only");
    assert.equal(p.band, null);
    assert.ok(p.top.every((r) => r.band === null));
  });

  it("no clock data: the Clock tab is null and the headline drops the clock clause", () => {
    const g = md.games.map(fromJson).map((x) => {
      if (x.accuracy === null) return x;
      const stats = [...x.stats];
      for (let s = 7; s <= 14; s++) stats[s] = 0;
      return { ...x, stats, errorLog: x.errorLog.map((c) => c & ~(0x7 << 7)) };
    });
    const p = parsed(input({ snapshot: snapshotOf(g) }));
    assert.equal(p.breakdown!.clock, null);
    assert.ok(!p.top.some((r) => r.pattern === "rc:timePressure"));
    assert.equal(p.headline!.text, "You lose most points to missed forks in the middlegame.");
  });

  it("most_frequent: nothing beats the band → the neutral headline and no band bars", () => {
    // 10 rook-endgame errors in 1 350 moves (0.74 per 100) against a band of 0.8: frequent, but no weakness.
    const g = games(30, (i) => ({ errors: i % 3 === 0 ? [err(["rookEndgame"], { phase: 2 })] : [], phaseMoves: [10, 20, 15] }));
    const p = parsed(input({ snapshot: snapshotOf(g.map((x) => ({ ...x, ratingBefore: 1184 }))) }));
    assert.equal(p.listMode, "most_frequent");
    assert.equal(p.headline!.text, "Nothing stands out against players at your level. Your mistakes are spread across many patterns.");
    assert.ok(p.top.every((r) => r.band === null));
    assert.deepEqual(p.top.map((r) => [r.pattern, r.events]), [["rookEndgame", 10]]);
  });
});
