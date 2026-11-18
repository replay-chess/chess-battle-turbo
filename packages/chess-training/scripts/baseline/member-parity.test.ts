// Member / band tagging parity (FIX-1, review finding "the member and the band are tagged differently"). The J5
// baseline tags every MISTAKE, BLUNDER and MISS from a full pass-1 PV (finishSide stores one for each error). The
// worker's analysis stores a pass-2 line only for the review's moments, so before FIX-1 a member error without one was
// tagged from its best move alone: multi-move motifs (forks, pins, discovered attacks, sacrifices, mates in 2–3)
// almost never showed, and the member's tactical rates read 20 % or more below the band.
//
// The worker now hands computeSideInputs the pass-1 PV of every error ply (`pass1Pv`, searched in pass 1 or by
// AnalyzeGame.weaknessLines). On FX `weakness/baseline-sample.json` (50 real Lichess CC0 sides with the pinned
// Stockfish 18 answers) the member path with no stored pass-2 line at all must tag exactly as the band path, and the
// old best-move-only path must lose tags (the bias this guards against).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { encodeMove, MOVE_UNKNOWN } from "@repo/chess-analysis/codec";
import { computeSideInputs, type SideInputsAnalysis } from "@repo/chess-analysis/weakness-inputs";
import type { BaselineSampleFile } from "./fixture";
import { loadBook } from "./grade";
import { finishSide, prepareSide, type PositionFacts } from "./side";

const require = createRequire(import.meta.url);
const sample = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/weakness/baseline-sample.json"), "utf8")) as BaselineSampleFile;
const { book } = loadBook();

function sides() {
  return sample.sides.map((s) => {
    const p = prepareSide(s.item, sample.start, book);
    if (!p.ok) throw new Error(`${s.item.id}: not prepared`);
    const facts = new Map<number, PositionFacts>(Object.entries(s.facts).map(([k, v]) => [Number(k), v]));
    const best = [...p.side.best];
    for (const need of p.side.needs) {
      const f = facts.get(need.index);
      best[need.index] = f?.best ? encodeMove(f.best) : MOVE_UNKNOWN;
    }
    // The member's stored analysis with no pass-2 line on any error (the worst case for the old path).
    const analysis: SideInputsAnalysis = {
      evals: p.side.evals,
      best,
      judgements: p.side.judgements,
      lines: {},
      middlegamePly: p.side.middlegamePly,
      endgamePly: p.side.endgamePly,
    };
    return { s, p: p.side, facts, analysis };
  });
}

describe("member / band tagging parity (FX baseline-sample.json, 50 real sides)", () => {
  it("regression: member-band-pv-bias — with the pass-1 PV of each error the member's tags equal the baseline's, side by side", () => {
    let errors = 0;
    for (const { s, p, facts, analysis } of sides()) {
      const band = finishSide(p, facts).inputs;
      const member = computeSideInputs(p.game, analysis, { color: s.item.color, result: p.result }, { replay: p.replay, pass1Pv: (i) => facts.get(i)?.pv });
      assert.deepEqual(member, band, s.item.id);
      errors += band.errorLog.length;
    }
    assert.ok(errors >= 150, `${errors} errors compared`);
  });

  it("the best-move-only path (no pass-1 PV) loses the multi-move motifs: the bias the worker no longer has", () => {
    let full = 0;
    let bestOnly = 0;
    const multi = ["fork", "pin", "discoveredAttack", "skewer", "sacrifice"];
    let fullMulti = 0;
    let bestMulti = 0;
    for (const { s, p, facts, analysis } of sides()) {
      const band = finishSide(p, facts).inputs.errorThemes;
      const old = computeSideInputs(p.game, analysis, { color: s.item.color, result: p.result }, { replay: p.replay }).errorThemes;
      full += band.length;
      bestOnly += old.length;
      fullMulti += band.filter((t) => multi.includes(t)).length;
      bestMulti += old.filter((t) => multi.includes(t)).length;
    }
    assert.ok(bestOnly < full * 0.6, `best move only ${bestOnly} tags vs ${full} with the PV`);
    assert.ok(fullMulti >= 30 && bestMulti <= fullMulti / 5, `multi-move motifs: ${fullMulti} with the PV, ${bestMulti} from the best move`);
  });

  it("regression: hinted-refutation-missing — an eval-hinted import (no best move past position 0) tags as the band once the position after each error is searched (FIX-2)", () => {
    let errors = 0;
    let threatsBand = 0;
    let threatsErrorOnly = 0;
    for (const { s, p, facts } of sides()) {
      // The worker's hinted analysis: Lichess %eval everywhere, our engine's best move only at position 0, no pass-2 line.
      const best = p.best.map((_, i) => (i === 0 ? p.best[0]! : MOVE_UNKNOWN));
      const hinted: SideInputsAnalysis = { evals: p.evals, best, judgements: p.judgements, lines: {}, middlegamePly: p.middlegamePly, endgamePly: p.endgamePly };
      const band = finishSide(p, facts).inputs;
      // AnalyzeGame.weaknessLines now searches every member error AND the position after it (the refutation).
      const report = { partial: 0 };
      const member = computeSideInputs(p.game, hinted, { color: s.item.color, result: p.result }, { replay: p.replay, pass1Pv: (i) => facts.get(i)?.pv, report });
      assert.deepEqual(member, band, s.item.id);
      assert.equal(report.partial, 0, `${s.item.id}: every error had its line and refutation`);
      // FIX-1's worker searched the error plies only: no refutation, so no "Missed threats".
      const errorPlies = new Set(p.errors);
      const errorOnly = computeSideInputs(p.game, hinted, { color: s.item.color, result: p.result }, {
        replay: p.replay,
        pass1Pv: (i) => (errorPlies.has(i) ? facts.get(i)?.pv : undefined),
      });
      threatsBand += band.errorThemes.filter((t) => t === "rc:missedThreat").length;
      threatsErrorOnly += errorOnly.errorThemes.filter((t) => t === "rc:missedThreat").length;
      errors += band.errorLog.length;
    }
    assert.ok(errors >= 150, `${errors} errors compared`);
    assert.ok(threatsBand >= 20 && threatsErrorOnly === 0, `rc:missedThreat: band ${threatsBand}, error plies only ${threatsErrorOnly}`);
  });

  it("report.partial counts the errors tagged from the best move alone (the heal's and B-W1's signal to arm a regrade)", () => {
    let partial = 0;
    for (const { s, p, analysis } of sides()) {
      const report = { partial: 0 };
      computeSideInputs(p.game, analysis, { color: s.item.color, result: p.result }, { replay: p.replay, report });
      partial += report.partial;
    }
    assert.ok(partial >= 150, `${partial} errors without a line`);
  });
});

