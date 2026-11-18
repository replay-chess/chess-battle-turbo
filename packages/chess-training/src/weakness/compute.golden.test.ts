// The golden design test (phase-06 plan §12.1, §13 WP1 acceptance): `test/fixtures/weakness/member-design.json`
// (212 in-scope games synthesised to the board) with the synthetic baseline must equal `member-design.golden.json`,
// and must reproduce every number of the V3WeaknessProfile board. `buildPayload(golden)` parses with the TR-5
// contract and stays below 8 KB with and without legend lessons. Regenerate the fixtures only with a reviewed
// `tsx scripts/build-member-design.ts --update`.
//
// One board number cannot be reproduced together with the others: the board's mock data shows the time-pressure row
// at 4.0 under 1 min and the Clock tab's "< 1 min" bar at 3.4, but copy note C4 / §8.8 make them one computation
// (same numerator and denominator). The golden keeps the row's 4.0 in both places and asserts they are equal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessPayload } from "@repo/contracts/http/weakness";
import { loadBaseline } from "../../baselines/load";
import { fromJson } from "../../test/gen";
import { buildMemberDesign, type MemberDesign } from "../../test/member-design";
import { computeWeakness, type WeaknessSnapshotDraft } from "./compute";
import { verifyHeadline } from "./headline";
import { buildPayload, type PayloadInput } from "./payload";
import { weekStartOf } from "./scope";

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/weakness");
const md = JSON.parse(readFileSync(resolve(FIX, "member-design.json"), "utf8")) as MemberDesign;
const golden = JSON.parse(readFileSync(resolve(FIX, "member-design.golden.json"), "utf8")) as unknown;
const NOW = new Date(md.now);

function compute(): WeaknessSnapshotDraft {
  return computeWeakness(md.games.map(fromJson), loadBaseline("v0-synthetic"), { now: NOW, timeZone: md.timeZone, profile: md.profile, ratingBand: md.ratingBand });
}

function designPayload(draft: WeaknessSnapshotDraft, lessons?: PayloadInput["lessons"]) {
  return buildPayload({
    now: NOW,
    timeZone: md.timeZone,
    snapshot: { weekStart: weekStartOf(NOW, md.timeZone), algoVersion: 1, status: draft.status as "READY", gamesInScope: draft.gamesInScope, gamesAnalysed: draft.gamesAnalysed, metrics: draft.metrics, computedAt: NOW },
    profile: { ...md.profile, puzzleRating: md.live.puzzleRating, weaknessVersion: md.live.weaknessVersion, lastWeaknessSeenVersion: md.live.lastWeaknessSeenVersion },
    inBank: md.live.inBank,
    probe: { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, games: null, importRun: null, lastAnalysedAt: null },
    isTrialing: false,
    secPerGame: 45,
    lanes: 1,
    lessons,
  });
}

describe("compute.golden (member-design × v0-synthetic)", () => {
  it("the committed fixture is what test/member-design.ts generates", () => {
    assert.deepEqual(md, JSON.parse(JSON.stringify(buildMemberDesign())));
  });

  it("equals member-design.golden.json", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(compute())), golden);
  });

  it("reproduces the board: rows, bands, trends, where lines, bank counts", () => {
    const p = designPayload(compute());
    assert.equal(p.status, "ready");
    const rows = [...p.top, ...p.more];
    assert.deepEqual(
      rows.map((r) => [r.label, r.you.toFixed(1), r.band?.toFixed(1), r.trendLabel, r.where, r.inBank]),
      [
        ["Missed forks", "3.1", "1.6", "Getting worse this month", "Middlegame · 7 of the last 20 games", 12],
        ["Missed free pieces", "2.4", "1.9", "About the same", "Middlegame · 5 of the last 20 games", 7],
        ["Time-pressure blunders", "4.0", "2.2", "Improving", "Under 1 minute · 4 of the last 20 games", 4],
        ["Slow development", "1.0", "0.5", "Getting worse this month", "Opening · 0 of the last 20 games", 3],
        ["Missed pins", "1.6", "0.9", "About the same", "Middlegame · 0 of the last 20 games", 5],
      ],
    );
    assert.equal(p.top[2]!.unit, "per100_under1min");
    assert.deepEqual(p.top.map((r) => r.slug), ["fork", "hanging-piece", "time-pressure"]);
    assert.equal(p.top.length, 3);
    assert.equal(p.more.length, 2, "2 more patterns found. All 5 have drills.");
    assert.deepEqual(p.band, { min: 1100, max: 1300, label: "1100–1300", source: "lichess" });
    assert.equal(p.rating, 1512);
  });

  it("reproduces the headline, the scope label and the VERIFIED tag", () => {
    const d = compute();
    const p = designPayload(d);
    assert.deepEqual(p.headline, {
      text: "You lose most points to missed forks in the middlegame, especially with under a minute on your clock.",
      short: "You lose most points to missed forks in the middlegame, especially under a minute.",
      verified: true,
    });
    assert.ok(verifyHeadline(d.metrics));
    assert.equal(p.scopeLabel, "212 games · rapid and blitz · since Aug 2026");
    assert.equal(p.scopeLabelShort, "212 games · since Aug 2026");
    assert.equal(d.headline, p.headline!.text);
  });

  it("reproduces the tabs: phases 88/84 · 71/76 · 79/74, clock 0.8 · 1.1 · 2.6 · 4.0 (C4), openings, 2 strengths", () => {
    const b = designPayload(compute()).breakdown!;
    assert.deepEqual(b.phase.rows.map((r) => [r.label, r.you, r.band]), [["Opening", 88, 84], ["Middlegame", 71, 76], ["Endgame", 79, 74]]);
    assert.equal(b.phase.sentence, "Accuracy by phase. Your openings and your endgames are above your band; the middlegame is where it drops.");
    assert.deepEqual(b.clock!.buckets.map((c) => [c.label, c.per100]), [["> 5 min", 0.8], ["2–5 min", 1.1], ["1–2 min", 2.6], ["< 1 min", 4]]);
    assert.equal(b.clock!.sentence, "Blunders per 100 moves, by time left on your clock. Below 2 minutes the rate triples.");
    assert.equal(b.clock!.ariaLabel, "Blunders per 100 moves: over 5 minutes 0.8, 2 to 5 minutes 1.1, 1 to 2 minutes 2.6, under 1 minute 4.0");
    assert.deepEqual(b.openings, [
      { family: "Two Knights Defence", ecoRange: "C55–C59", games: 38, scorePct: 47, note: "most_played" },
      { family: "Queen’s Gambit Declined", ecoRange: "D30–D69", games: 24, scorePct: 38, note: "most_points_lost" },
      { family: "Sicilian, Alapin", ecoRange: "B22", games: 21, scorePct: 57, note: null },
      { family: "London System", ecoRange: "D02", games: 19, scorePct: 61, note: "best_score" },
    ]);
    assert.deepEqual(b.strengths, [
      "You convert won positions: 9 of your last 10 games that reached +3 or better ended in a win.",
      "Your openings as White are sound: you leave book with an equal position 81% of the time.",
    ]);
    const tpRow = designPayload(compute()).top[2]!;
    assert.equal(tpRow.you, b.clock!.buckets[3]!.per100, "copy note C4: the row and the < 1 min bar are one computation");
  });

  it("reproduces the week plan (drill 6 + 4, fork puzzles at 1512) and the scope counts", () => {
    const d = compute();
    const p = designPayload(d);
    assert.deepEqual(p.weekPlan, [
      { kind: "drill", label: "Drill missed forks", sub: "10 positions · 6 from your games + 4 matched puzzles", href: "/train/weakness/fork" },
      { kind: "puzzles", label: "Fork puzzles at 1512", sub: "3 drills a session, under a minute each", href: "/train/puzzles?theme=fork&n=3" },
    ]);
    // FIX-2: every in-scope game is analysed (the rows and trends now need evidence; test/member-design.ts header).
    assert.deepEqual(d.metrics.games, { inScope: 212, analysed: 212, excludedBot: 2 });
    assert.equal(d.gamesInScope, 212);
    assert.deepEqual([d.ratingBandMin, d.ratingBandMax], [1100, 1300]);
    assert.deepEqual(d.metrics.topKeys, ["fork", "hangingPiece", "rc:timePressure"]);
    assert.deepEqual(d.metrics.inputs, { watermarkEndedAt: "2026-11-15T22:00:00.000Z", healed: 0, baseline: "v0-synthetic", engineProfile: "sf18-v1" });
  });

  it("buildPayload(golden) parses with WeaknessPayload and stays below 8 KB, with and without legend lessons", () => {
    const d = compute();
    const plain = designPayload(d);
    assert.equal(WeaknessPayload.safeParse(plain).success, true, JSON.stringify(WeaknessPayload.safeParse(plain).error?.issues));
    assert.ok(JSON.stringify(plain).length < WEAKNESS_PAYLOAD_MAX_BYTES, `${JSON.stringify(plain).length} B`);
    const lesson = { slug: "tal-vs-smyslov-1959", title: "Tal vs Smyslov, 1959", sub: "A world champion’s forks, then play it out" };
    const withLessons = designPayload(d, { fork: lesson, hangingPiece: { ...lesson, title: "Morphy’s Opera Game, 1858" }, "rc:timePressure": { ...lesson, title: "Fischer vs Taimanov, 1971" } });
    assert.equal(WeaknessPayload.safeParse(withLessons).success, true);
    assert.ok(JSON.stringify(withLessons).length < WEAKNESS_PAYLOAD_MAX_BYTES, `${JSON.stringify(withLessons).length} B`);
    assert.equal(withLessons.weekPlan[2]!.label, "Legend lesson: Tal vs Smyslov, 1959");
    assert.equal(withLessons.weekPlan[2]!.href, "/learn/lessons/tal-vs-smyslov-1959?from=weakness");
  });
});
