// The headline (phase-06 plan §8.17, §12.1): the desktop and short texts of the design case, the time-pressure
// variant, most_frequent, every claim checked by verifyHeadline, and a mutated metric that fails verification and
// falls back to the claim-free text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHeadline, fallbackHeadline, NEUTRAL_HEADLINE, verifiedHeadline, verifyHeadline } from "./headline";

// 4,000 moves, 400 of them under a minute. Forks: 140 events, 40 under a minute → 10 per 100 under a minute vs 2.8
// with more time (3.6×): the clause holds.
const lt1 = (moves: number) => ({ buckets: [{ key: "gt5", moves: 2000 }, { key: "2to5", moves: 1000 }, { key: "1to2", moves: 600 }, { key: "lt1", moves }] });
const clock = { clock: lt1(400) };
const fork = { pattern: "fork", label: "Missed forks", phaseMode: "middlegame" as const, events: 140, eventsLt1: 40, moves: 4000 };
const hp = { pattern: "hangingPiece", label: "Missed free pieces", phaseMode: "middlegame" as const, events: 108, eventsLt1: 0, moves: 4000 };
const tp = { pattern: "rc:timePressure", label: "Time-pressure blunders", phaseMode: "middlegame" as const, events: 10, eventsLt1: 10, moves: 400 };

describe("headline", () => {
  it("the design case: missed forks in the middlegame, with the clock clause (forks are more frequent under a minute)", () => {
    const h = buildHeadline("vs_band", [fork, hp, tp], clock.clock);
    assert.equal(h.text, "You lose most points to missed forks in the middlegame, especially with under a minute on your clock.");
    assert.equal(h.short, "You lose most points to missed forks in the middlegame, especially under a minute.");
    assert.deepEqual(h.claims, [{ k: "pattern", key: "fork" }, { k: "phase", phase: "middlegame" }, { k: "clock", bucket: "lt1" }]);
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [fork, hp, tp], headline: h, breakdown: clock }), true);
  });

  it("the clock clause needs the top pattern itself ≥ 1.5× as frequent per move under a minute, ≥ 5 such events, ≥ 30 such moves, and a Clock tab", () => {
    const has = (row: typeof fork, c = clock.clock) => buildHeadline("vs_band", [row, hp], c).claims.some((x) => x.k === "clock");
    // 400 of 4,000 moves under a minute: rest rate (140 − e) / 3,600; the clause needs e / 400 ≥ 1.5 · that.
    assert.ok(has({ ...fork, eventsLt1: 20 }), "20/400 = 5.0 vs 120/3600 = 3.3 per 100: 1.5×");
    assert.ok(!has({ ...fork, eventsLt1: 19 }), "19/400 = 4.75 vs 121/3600 = 3.36: 1.41×");
    assert.ok(!has({ ...fork, events: 8, eventsLt1: 4 }), "4 events under a minute are too few to claim it");
    assert.ok(!has({ ...fork, eventsLt1: 20 }, lt1(29)), "29 moves under a minute have no rate");
    const noClock = buildHeadline("vs_band", [fork, hp, tp], null);
    assert.equal(noClock.text, "You lose most points to missed forks in the middlegame.");
    assert.equal(buildHeadline("own_only", [{ ...fork, phaseMode: null }], null).text, "You lose most points to missed forks.");
  });

  it("regression: headline-clock-clause-untrue — time pressure as another row no longer lends the clause to a pattern that is rare under a minute", () => {
    // Member H (INTEGRATE-2 Docker rows): missed threats 146 events, 8 of them under a minute (5 %), time pressure row 2,
    // 2,103 of 9,880 moves under a minute. Missed threats are LESS frequent per move under a minute (0.38 vs 1.77).
    const mt = { pattern: "rc:missedThreat", label: "Missed threats", phaseMode: "middlegame" as const, events: 146, eventsLt1: 8, moves: 9880 };
    const h = buildHeadline("vs_band", [mt, { ...tp, events: 86, eventsLt1: 86, moves: 2103 }], lt1(2103));
    assert.equal(h.text, "You lose most points to missed threats in the middlegame.");
    assert.ok(!h.claims.some((c) => c.k === "clock"));
  });

  it("time pressure on top", () => {
    const h = buildHeadline("vs_band", [tp, fork], clock.clock);
    assert.equal(h.text, "You lose most points to blunders with under a minute on your clock.");
    assert.equal(h.short, "You lose most points to blunders under a minute.");
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [tp, fork], headline: h, breakdown: clock }), true);
  });

  it("most_frequent: the neutral sentence, no claims", () => {
    const h = buildHeadline("most_frequent", [fork], clock.clock);
    assert.deepEqual(h, { text: NEUTRAL_HEADLINE, short: NEUTRAL_HEADLINE, claims: [] });
    assert.equal(verifyHeadline({ listMode: "most_frequent", rows: [fork], headline: h, breakdown: clock }), true);
    assert.ok(h.text.length <= 120);
  });

  it("a mutated metric fails verification; the stored headline falls back to the claim-free text", () => {
    const h = buildHeadline("vs_band", [fork, hp, tp], clock.clock);
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [{ ...fork, phaseMode: "endgame" }, hp, tp], headline: h, breakdown: clock }), false, "phase claim");
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [hp, fork, tp], headline: h, breakdown: clock }), false, "pattern claim");
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [fork, hp, tp], headline: h, breakdown: { clock: null } }), false, "clock claim");
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [{ ...fork, eventsLt1: 4 }, hp, tp], headline: h, breakdown: clock }), false, "clock claim (rate)");
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [fork, hp, tp], headline: { ...h, text: "You lose most points to everything." }, breakdown: clock }), false, "free text");
    // The stored headline is the template when it verifies …
    assert.deepEqual(verifiedHeadline("vs_band", [fork, hp, tp], clock), h);
    // … and the claim-free fallback when a (faulty) template's claims do not hold.
    const faulty = () => ({ ...h, claims: [...h.claims.filter((c) => c.k !== "phase"), { k: "phase" as const, phase: "endgame" as const }] });
    assert.deepEqual(verifiedHeadline("vs_band", [fork, hp, tp], clock, faulty), {
      text: "You lose most points to missed forks.",
      short: "You lose most points to missed forks.",
      claims: [{ k: "pattern", key: "fork" }],
    });
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [fork], headline: fallbackHeadline([fork]), breakdown: clock }), true, "the fallback verifies");
  });

  it("regression: headline-label-phrases — each pattern's own noun phrase; no phase clause on a label that names it (FIX-2)", () => {
    const row = (pattern: string, label: string, phaseMode: "opening" | "middlegame" | "endgame") => ({ pattern, label, phaseMode, events: 30, eventsLt1: 0, moves: 3000 });
    assert.equal(buildHeadline("vs_band", [row("rookEndgame", "Rook endgames", "endgame")], clock.clock).text, "You lose most points to rook endgames.");
    assert.deepEqual(buildHeadline("vs_band", [row("rookEndgame", "Rook endgames", "endgame")], clock.clock).claims, [{ k: "pattern", key: "rookEndgame" }]);
    assert.equal(buildHeadline("vs_band", [row("rc:recapture", "Missed recaptures", "middlegame")], clock.clock).text, "You lose most points to missed recaptures in the middlegame.");
    assert.equal(buildHeadline("vs_band", [row("promotion", "Missed promotions", "endgame")], clock.clock).text, "You lose most points to missed promotions in the endgame.");
    assert.equal(buildHeadline("vs_band", [row("backRankMate", "Missed back-rank mates", "middlegame")], clock.clock).text, "You lose most points to missed back-rank mates in the middlegame.");
    assert.equal(buildHeadline("vs_band", [row("rc:kingSafety", "King safety", "middlegame")], clock.clock).text, "You lose most points to weakening your king's shelter in the middlegame.");
    // A stored headline claiming a phase on an endgame tag does not verify.
    const r = row("pawnEndgame", "Pawn endgames", "endgame");
    const forged = { text: "You lose most points to pawn endgames in the endgame.", short: "You lose most points to pawn endgames in the endgame.", claims: [{ k: "pattern" as const, key: "pawnEndgame" }, { k: "phase" as const, phase: "endgame" as const }] };
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [r], headline: forged, breakdown: clock }), false);
    assert.equal(verifyHeadline({ listMode: "vs_band", rows: [r], headline: buildHeadline("vs_band", [r], clock.clock), breakdown: clock }), true);
  });
});
