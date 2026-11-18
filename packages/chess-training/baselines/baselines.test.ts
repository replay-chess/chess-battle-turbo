// The real rating-band baseline `v1.json` (phase-06 plan §7.4.5 step 8, §12.1, §13 WP2 acceptance): built by J5
// (`scripts/build-baseline.ts`) from one 2026 Lichess monthly dump with the worker's pinned Stockfish 18 and `sf18-v1`.
//   - the strict schema; not synthetic; the worker's engine profile in the file and in v1.meta.json;
//   - the engine pin recorded in the meta equals scripts/baseline/pin.ts ENGINE_PIN (binary, nets, commit, bench);
//   - the dump is a 2026 standard rated month with its published sha256;
//   - every cell 600–2400 × BULLET / BLITZ / RAPID has ≥ 20 000 moves and the per-cell sample (≥ 1 000), unless the
//     meta explains a shortfall at 2300+ (the only one the plan allows);
//   - blunder rates fall with the band (soft: at most 20 % of adjacent pairs may invert; the inversions are printed);
//   - the 1100 blitz fork rate is inside the sanity bounds 0.5–4.0 per 100 moves;
//   - the v1 golden of the design member (`member-design.v1.golden.json`) is what computeWeakness gives with v1.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import { ENGINE_PIN } from "../scripts/baseline/pin";
import { computeWeakness } from "../src/weakness/compute";
import { ALGO_VERSION } from "../src/weakness/constants";
import { WEAKNESS_CANDIDATES } from "../src/themes";
import { fromJson } from "../test/gen";
import type { MemberDesign } from "../test/member-design";
import { DEFAULT_BASELINE_ID, assertBaselineProfile, isSyntheticBaseline, loadBaseline } from "./load";
import { BASELINE_TIME_CLASSES, bandKeys, parseBaseline, parseBaselineMeta, type BaselineCell } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => JSON.parse(readFileSync(resolve(here, p), "utf8")) as unknown;
const v1 = parseBaseline(read("v1.json"));
const meta = parseBaselineMeta(read("v1.meta.json"));
const MIN_MOVES = 20_000;
const MIN_SAMPLE = 1_000;
const BANDS = Array.from({ length: 19 }, (_, i) => String(600 + i * 100));

/** Blunders per 100 graded moves of a cell (every clock bucket). */
function blunders100(c: BaselineCell): number {
  const blunders = c.clockBlunders100.reduce((s, r, i) => s + (r * c.clockMoves[i]!) / 100, 0);
  return (100 * blunders) / c.moves;
}

describe("baseline v1 (J5, real 2026 dump)", () => {
  it("is the default baseline, real, and graded with the worker's engine profile", () => {
    assert.equal(DEFAULT_BASELINE_ID, "v1");
    const b = loadBaseline();
    assert.equal(b.id, "v1");
    assert.equal(isSyntheticBaseline(b), false);
    assert.equal(b.synthetic, false);
    assert.equal(b.profile, ENGINE_PROFILE.id);
    assert.equal(b.gradingVersion, GRADING_VERSION);
    assert.equal(b.algoVersion, ALGO_VERSION);
    assert.doesNotThrow(() => assertBaselineProfile(b, ENGINE_PROFILE.id));
    assert.deepEqual(b.ratingOffsets, { CHESSCOM: { BULLET: 0, BLITZ: 0, RAPID: 0 } }, "D-P6-5: 0 in v1 [V]");
  });

  it("records the engine pin: the worker's binary, both nets, the source commit, the bench signature and the profile", () => {
    assert.equal(meta.id, "v1");
    assert.equal(meta.profile, ENGINE_PROFILE.id);
    assert.equal(meta.engine.binarySha256, ENGINE_PIN.binarySha256);
    assert.deepEqual(meta.engine.nets, { big: ENGINE_PIN.nets.big.sha256, small: ENGINE_PIN.nets.small.sha256 });
    assert.equal(meta.engine.commit, ENGINE_PIN.commit);
    assert.equal(meta.engine.benchNodes, ENGINE_PIN.benchNodes);
    assert.equal(meta.engine.buildId, ENGINE_PIN.buildId);
    assert.deepEqual(meta.engine.pass1, ENGINE_PROFILE.pass1);
    assert.equal(meta.engine.threads, ENGINE_PROFILE.threads);
    assert.equal(meta.engine.hashMb, ENGINE_PROFILE.hashMb);
  });

  it("names one 2026 Lichess standard rated monthly dump and its published sha256", () => {
    assert.match(meta.dump.name, /^lichess_db_standard_rated_2026-(0[1-9]|1[0-2])\.pgn\.zst$/);
    assert.match(meta.dump.sha256Published, /^[0-9a-f]{64}$/);
    assert.equal(v1.source.dump, meta.dump.name);
    assert.ok(v1.source.games > 0 && v1.source.games <= meta.dump.eligible);
    assert.ok(meta.dump.chunks.length > 0 || meta.dump.mode === "stream");
  });

  it("has every cell 600–2400 × BULLET / BLITZ / RAPID with ≥ 20 000 moves and the per-cell sample, or an explained 2300+ shortfall", () => {
    assert.deepEqual(bandKeys(v1), BANDS);
    assert.ok(meta.sampling.samplePerCell >= MIN_SAMPLE, `samplePerCell ${meta.sampling.samplePerCell}`);
    const explained = new Map(meta.shortfalls.map((s) => [s.cell, s]));
    for (const s of meta.shortfalls) {
      assert.ok(Number(s.cell.split(":")[0]) >= 2300, `${s.cell} is short (${s.sides} sides) below 2300: ${s.reason}`);
      assert.ok(s.reason.length > 20, `${s.cell}: the shortfall needs a reason`);
    }
    for (const band of BANDS)
      for (const tc of BASELINE_TIME_CLASSES) {
        const key = `${band}:${tc}`;
        const c = v1.bands[band]![tc];
        assert.equal(meta.cells[key]?.sides, c.sides, key);
        assert.equal(meta.cells[key]?.moves, c.moves, key);
        if (!explained.has(key)) {
          assert.ok(c.moves >= MIN_MOVES, `${key}: ${c.moves} moves`);
          assert.equal(c.sides, meta.sampling.samplePerCell, `${key}: ${c.sides} sides`);
        } else assert.ok(c.sides < meta.sampling.samplePerCell, `${key} is listed short but is not`);
        // Every graded move has a clock bucket except a side's first move in a game without a base time (0+n bullet:
        // CA clock.ts has no clock before ply 0/1 there), so at most one per side.
        const clocked = c.clockMoves.reduce((s, x) => s + x, 0);
        assert.ok(clocked <= c.moves && clocked >= c.moves - c.sides, `${key}: ${clocked} clocked of ${c.moves} moves`);
        if (tc !== "BULLET") assert.equal(clocked, c.moves, `${key}: only 0+n bullet games lack a first clock`);
        assert.equal(c.timePressure.per100Lt1, c.clockBlunders100[3], `${key}: one computation for the lt1 bar and the row (C4)`);
        for (const k of WEAKNESS_CANDIDATES.filter((x) => x !== "rc:timePressure")) assert.ok(k in c.themes, `${key} ${k}`);
      }
  });

  it("blunder rates fall with the band (soft check: ≤ 20 % of adjacent pairs may invert)", () => {
    let pairs = 0;
    const inverted: string[] = [];
    for (const tc of BASELINE_TIME_CLASSES)
      for (let i = 1; i < BANDS.length; i++) {
        const lo = blunders100(v1.bands[BANDS[i - 1]!]![tc]);
        const hi = blunders100(v1.bands[BANDS[i]!]![tc]);
        pairs += 1;
        if (hi > lo) inverted.push(`${tc} ${BANDS[i - 1]}→${BANDS[i]}: ${lo.toFixed(3)} → ${hi.toFixed(3)}`);
      }
    if (inverted.length > 0) console.warn(`baseline v1: ${inverted.length} of ${pairs} adjacent pairs invert:\n  ${inverted.join("\n  ")}`);
    assert.ok(inverted.length / pairs <= 0.2, `${inverted.length} of ${pairs} pairs invert`);
  });

  it("the 1100 blitz fork rate is inside the sanity bounds (0.5–4.0 per 100 moves)", () => {
    const fork = v1.bands["1100"]!.BLITZ.themes.fork!.per100;
    assert.ok(fork >= 0.5 && fork <= 4.0, String(fork));
  });

  it("calibration covers every band with factors from blitz sides graded twice", () => {
    assert.deepEqual(Object.keys(v1.calibration).sort((a, b) => Number(a) - Number(b)), BANDS);
    assert.equal(meta.calibration.timeClass, "BLITZ");
    const graded = Object.values(meta.calibration.detail).reduce((s, d) => s + d.sides, 0);
    assert.ok(graded >= meta.calibration.sidesPerCell * 15, `${graded} calibration sides`);
    for (const band of BANDS) for (const f of Object.values(v1.calibration[band]!)) assert.ok(f > 0.25 && f < 4, `${band}: factor ${f}`);
  });

  it("FIX-2: every theme carries its capped rate (≤ the raw one) and every candidate a dispersion ≥ 1", () => {
    for (const band of BANDS)
      for (const tc of ["BULLET", "BLITZ", "RAPID"] as const)
        for (const [key, t] of Object.entries(v1.bands[band]![tc].themes)) {
          assert.ok(t.capped100 !== undefined && t.capped100 <= t.per100 + 1e-9, `${band}:${tc} ${key}`);
        }
    for (const key of WEAKNESS_CANDIDATES) assert.ok((v1.dispersion?.[key] ?? 0) >= 1, key);
    // Endgame tags cluster inside games, single-move tactics do not (J5: φ ≈ 1.57 vs ≈ 1.0–1.1).
    assert.ok(v1.dispersion!.rookEndgame! > 1.4 && v1.dispersion!.pin! < 1.1);
    const c = v1.bands["1500"]!.BLITZ;
    assert.ok(c.themes.rookEndgame!.capped100! / c.themes.rookEndgame!.per100 < 0.75, "rook endgames cluster");
    assert.ok(c.themes.fork!.capped100! / c.themes.fork!.per100 > 0.9, "forks do not");
  });

  it("member-design.v1.golden.json is computeWeakness(member-design, v1)", () => {
    const md = JSON.parse(readFileSync(resolve(here, "../test/fixtures/weakness/member-design.json"), "utf8")) as MemberDesign;
    const golden = JSON.parse(readFileSync(resolve(here, "../test/fixtures/weakness/member-design.v1.golden.json"), "utf8")) as unknown;
    const out = computeWeakness(md.games.map(fromJson), loadBaseline("v1"), { now: new Date(md.now), timeZone: md.timeZone, profile: md.profile, ratingBand: md.ratingBand });
    assert.deepEqual(JSON.parse(JSON.stringify(out)), golden);
    assert.equal(out.metrics.inputs.baseline, "v1");
  });
});
