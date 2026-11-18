// Weakness drills (phase-06 plan §8.11, §12.1): 10 + mix → 6 own + 4 puzzles in the order o p o p o p o p o o;
// 20 → 12 + 8; mix off with 7 own → 7 (few); zero own + matchable → puzzles only; zero own + unmatched → empty_drill;
// time pressure → own only; a puzzle shortfall (the shards return 2) → size 8 with `widened`; the preview matches the
// composer; TR-7 builds the session through TRN/src/session.ts (P5 runner items, never counting toward the cap).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { newCardRow } from "../fsrs";
import { type BankCardIn, buildSession, type PuzzlePick, type PuzzleTuple } from "../session";
import { composeWeaknessDrill, drillTitle, interleaveDrill, planWeaknessDrill, previewWeaknessDrill, weaknessMatchTheme } from "./drill";
import { weaknessDrillEyebrow } from "./labels";

const NOW = new Date("2026-11-17T09:30:00.000Z");
const own = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const puz = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const order = (entries: readonly { source: "own" | "puzzle" }[]) => entries.map((e) => (e.source === "own" ? "o" : "p")).join(" ");

describe("planWeaknessDrill / composeWeaknessDrill", () => {
  it("10 + mix → 6 own + 4 puzzles, o p o p o p o p o o", () => {
    const d = composeWeaknessDrill({ pattern: "fork", size: 10, mix: true, own: own(12), puzzles: puz(10) });
    assert.equal(order(d.entries), "o p o p o p o p o o");
    assert.deepEqual([d.own, d.puzzles, d.size, d.estMin], [6, 4, 10, 5]);
    assert.deepEqual(d.entries.filter((e) => e.source === "own").map((e) => e.item), ["m1", "m2", "m3", "m4", "m5", "m6"], "Q-W7 order kept");
  });

  it("20 + mix → 12 + 8", () => {
    const d = composeWeaknessDrill({ pattern: "fork", size: 20, mix: true, own: own(30), puzzles: puz(20) });
    assert.deepEqual([d.own, d.puzzles, d.size, d.estMin], [12, 8, 20, 10]);
  });

  it("mix off with 7 own → 7 positions (few), no puzzles", () => {
    const d = composeWeaknessDrill({ pattern: "fork", size: 10, mix: false, own: own(7), puzzles: puz(10) });
    assert.deepEqual([d.own, d.puzzles, d.size, d.estMin], [7, 0, 7, 4]);
  });

  it("an own shortfall is filled with puzzles; zero own + matchable → puzzles only (mix forced on)", () => {
    assert.deepEqual(planWeaknessDrill({ pattern: "fork", size: 10, mix: true, ownCount: 3 }), { ok: true, matchTheme: "fork", matchable: true, mixEff: true, ownTarget: 6, ownTake: 3, puzTarget: 7 });
    const d = composeWeaknessDrill({ pattern: "fork", size: 10, mix: false, own: [], puzzles: puz(10) });
    assert.deepEqual([d.own, d.puzzles, d.mixEff], [0, 10, true]);
  });

  it("zero own + unmatched → empty_drill; an unknown or non-candidate pattern → unknown_pattern", () => {
    assert.deepEqual(planWeaknessDrill({ pattern: "rc:pawnStructure", size: 10, mix: true, ownCount: 0 }), { ok: false, reason: "empty_drill" });
    assert.deepEqual(planWeaknessDrill({ pattern: "rc:timePressure", size: 10, mix: true, ownCount: 0 }), { ok: false, reason: "empty_drill" });
    assert.deepEqual(planWeaknessDrill({ pattern: "bogus", size: 10, mix: true, ownCount: 5 }), { ok: false, reason: "unknown_pattern" });
    assert.deepEqual(planWeaknessDrill({ pattern: "advantage", size: 10, mix: true, ownCount: 5 }), { ok: false, reason: "unknown_pattern" });
    assert.throws(() => composeWeaknessDrill({ pattern: "rc:pawnStructure", size: 10, mix: true, own: [], puzzles: [] }), /empty_drill/);
  });

  it("time pressure → own positions only (puzzles have no clock), whatever `mix` says", () => {
    assert.equal(weaknessMatchTheme("rc:timePressure"), null);
    const d = composeWeaknessDrill({ pattern: "rc:timePressure", size: 10, mix: true, own: own(4), puzzles: puz(10) });
    assert.deepEqual([d.own, d.puzzles, d.size, d.mixEff], [4, 0, 4, false]);
  });

  it("matches the taxonomy's Lichess themes", () => {
    assert.equal(weaknessMatchTheme("fork"), "fork");
    assert.equal(weaknessMatchTheme("rc:defendedTarget"), "hangingPiece");
    assert.equal(weaknessMatchTheme("rc:missedThreat"), "defensiveMove");
    assert.equal(weaknessMatchTheme("rc:kingSafety"), "kingsideAttack");
    assert.equal(weaknessMatchTheme("rc:pawnStructure"), null);
  });

  it("interleaves o p o p …, then the rest", () => {
    assert.deepEqual(interleaveDrill(["a", "b"], ["1", "2", "3", "4"]), ["a", "1", "b", "2", "3", "4"]);
    assert.deepEqual(interleaveDrill([], ["1"]), ["1"]);
  });
});

describe("previewWeaknessDrill", () => {
  it("speaks the config lines of the owner script (T4, T6)", () => {
    const p10 = previewWeaknessDrill({ pattern: "fork", inBank: 12, size: 10, mix: true, rating: 1512 });
    assert.equal(p10.mixLine, "6 from your games + 4 matched Lichess puzzles near 1512");
    assert.equal(p10.cta, "Start drill · 10 positions · ~5 min");
    const p20 = previewWeaknessDrill({ pattern: "fork", inBank: 12, size: 20, mix: true, rating: 1512 });
    assert.equal(p20.mixLine, "12 from your games + 8 matched Lichess puzzles near 1512");
    assert.equal(p20.cta, "Start drill · 20 positions · ~10 min");
    const off = previewWeaknessDrill({ pattern: "fork", inBank: 12, size: 20, mix: false, rating: 1512 });
    assert.equal(off.mixLine, "12 from your games only (12 in your bank)");
    assert.equal(off.cta, "Start drill · 12 positions · ~6 min");
    assert.equal(off.few, true);
    const few = previewWeaknessDrill({ pattern: "hangingPiece", inBank: 7, size: 10, mix: false, rating: null });
    assert.equal(few.cta, "Start drill · 7 positions · ~4 min");
    const tp = previewWeaknessDrill({ pattern: "rc:timePressure", inBank: 4, size: 10, mix: true, rating: 1512 });
    assert.deepEqual([tp.mixDisabled, tp.mixDisabledReason, tp.mixLine], [true, "time_pressure", "4 from your games only (4 in your bank)"]);
    const zero = previewWeaknessDrill({ pattern: "fork", inBank: 0, size: 10, mix: false, rating: null });
    assert.deepEqual([zero.mixEff, zero.mixDisabledReason, zero.mixLine], [true, "zero_own", "10 matched Lichess puzzles at your level"]);
    const empty = previewWeaknessDrill({ pattern: "rc:pawnStructure", inBank: 0, size: 10, mix: true, rating: 1512 });
    assert.deepEqual([empty.empty, empty.mixDisabledReason, empty.total], [true, "unmatched", 0]);
  });

  it("matches the composer for the same inputs (enough puzzles)", () => {
    for (const pattern of ["fork", "hangingPiece", "rc:timePressure", "rc:pawnStructure", "rc:missedThreat"]) {
      for (const inBank of [0, 3, 6, 7, 12, 25]) {
        for (const size of [10, 20] as const) {
          for (const mix of [true, false]) {
            const plan = planWeaknessDrill({ pattern, size, mix, ownCount: inBank });
            const preview = previewWeaknessDrill({ pattern, inBank, size, mix, rating: 1500 });
            if (!plan.ok) {
              assert.equal(preview.empty, true, `${pattern} ${inBank} ${size} ${mix}`);
              continue;
            }
            const d = composeWeaknessDrill({ pattern, size, mix, own: own(inBank), puzzles: puz(40) });
            assert.deepEqual([preview.own, preview.puzzles, preview.total, preview.estMin, preview.mixEff], [d.own, d.puzzles, d.size, d.estMin, d.mixEff], `${pattern} ${inBank} ${size} ${mix}`);
          }
        }
      }
    }
  });

  it("titles and the summary eyebrow", () => {
    assert.equal(drillTitle("fork"), "Drill missed forks");
    assert.equal(weaknessDrillEyebrow("Missed forks", 10), "Missed forks drill · 10 positions");
  });
});

describe("buildSession('weakness', …) (TR-7 through session.ts)", () => {
  const card = (key: string): BankCardIn => ({ key, kind: "MISTAKE", card: newCardRow(NOW), lastPlayedAt: NOW });
  const tuple = (id: string, rating: number): PuzzleTuple => [id, "8/8/8/8/8/8/8/8 w - - 0 1", "e2e4 e7e5", rating, 1];
  const pick = (n: number, widened: PuzzlePick["widened"] = null): PuzzlePick => ({
    items: Array.from({ length: n }, (_, i) => ({ source: "shard" as const, puzzle: tuple(`Pz${1000 + i}`, 1450 + i * 10) })),
    theme: "fork",
    window: { from: 1412, to: 1662 },
    widened,
  });

  it("6 own + 4 puzzles, interleaved; own items keep previews (FSRS); never counts toward the cap", () => {
    const plan = buildSession("weakness", { pattern: "fork", size: 10, mix: true, own: own(12).map(card), puzzles: pick(4) });
    assert.equal(plan.kind, "weakness");
    assert.equal(plan.countsTowardCap, false);
    assert.equal(plan.theme, "fork");
    assert.deepEqual(plan.items.map((i) => (i.kind === "LICHESS_PUZZLE" ? "p" : "o")).join(" "), "o p o p o p o p o o");
    assert.deepEqual(plan.items.map((i) => i.itemId), ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8", "i9", "i10"]);
    assert.equal(plan.items[1]!.key, "p_Pz1000");
    assert.ok(plan.items.every((i) => i.previews && i.pass === 1));
    assert.equal(plan.empty, null);
  });

  it("a puzzle shortfall (the shards return 2) gives 8 positions and reports the widened window", () => {
    const plan = buildSession("weakness", { pattern: "fork", size: 10, mix: true, own: own(12).map(card), puzzles: pick(2, { from: 1300, to: 1800 }) });
    assert.equal(plan.items.length, 8);
    assert.deepEqual(plan.widened, { from: 1300, to: 1800 });
  });

  it("time pressure: own items only, no widened window", () => {
    const plan = buildSession("weakness", { pattern: "rc:timePressure", size: 10, mix: true, own: own(4).map(card), puzzles: null });
    assert.equal(plan.items.length, 4);
    assert.ok(plan.items.every((i) => i.kind === "MISTAKE"));
    assert.equal(plan.widened, null);
  });
});
