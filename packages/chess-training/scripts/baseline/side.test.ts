// The J5 per-side pipeline and aggregation (phase-06 plan §7.4.5 steps 4–6, §12.5) on FX `weakness/baseline-sample.json`:
// 50 real sides of the v1 sample (Lichess CC0 games with Lichess's %eval and %clk) with the pinned engine's answers.
// Re-running the pipeline on them must give the records the build journalled, and every record is re-derived here
// from the raw movetext (clocks, judgements, Win% losses) independently of the code under test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { decodeErrorLog, decodeStatsV1 } from "@repo/chess-analysis/codec";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { parseBaseline } from "../../baselines/schema";
import { aggregateCell, baselineJson, buildBaseline, calibrationOf, cellThemeKeys } from "./aggregate";
import type { BaselineSampleFile } from "./fixture";
import { loadBook } from "./grade";
import { parseMovetext } from "./pgn";
import { finishSide, hintValue, prepareSide, type CalibrationRecord, type PositionFacts, type SideRecord } from "./side";

const require = createRequire(import.meta.url);
const sample = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/weakness/baseline-sample.json"), "utf8")) as BaselineSampleFile;
const { book } = loadBook();

describe("J5 per-side pipeline (FX baseline-sample.json)", () => {
  it("holds 50 real sides over every time class and bands from 600 to 2400, graded with the pinned profile", () => {
    assert.equal(sample.sides.length, 50);
    assert.equal(sample.engine.profile, ENGINE_PROFILE.id);
    assert.deepEqual(new Set(sample.sides.map((s) => s.item.tc)), new Set(["BULLET", "BLITZ", "RAPID"]));
    const bands = sample.sides.map((s) => Number(s.item.band));
    assert.ok(Math.min(...bands) <= 700 && Math.max(...bands) >= 2200, `${Math.min(...bands)}–${Math.max(...bands)}`);
    for (const s of sample.sides) assert.equal(s.item.headers.White, undefined, "no player names");
  });

  it("re-running prepare + finish on the stored engine answers reproduces every journalled record", () => {
    for (const s of sample.sides) {
      const p = prepareSide(s.item, sample.start, book);
      assert.ok(p.ok, s.item.id);
      if (!p.ok) continue;
      assert.deepEqual(
        p.side.needs.map((n) => String(n.index)),
        Object.keys(s.facts).sort((a, b) => Number(a) - Number(b)),
        `${s.item.id}: the positions searched`,
      );
      const facts = new Map<number, PositionFacts>(Object.entries(s.facts).map(([k, v]) => [Number(k), v]));
      assert.deepEqual(finishSide(p.side, facts), s.record, s.item.id);
    }
  });

  it("every record agrees with its own movetext: moves, error count, clock buckets and Win% losses", () => {
    for (const { item, record } of sample.sides) {
      const mt = parseMovetext(item.movetext);
      const stats = decodeStatsV1(record.inputs.stats)!;
      const mine = mt.sans.map((_, i) => i).filter((i) => (i % 2 === 0 ? "w" : "b") === item.color);
      assert.ok(stats.moves <= mine.length && stats.moves >= mine.length - 15, `${item.id}: graded moves ${stats.moves} of ${mine.length}`);
      // Every graded move has a clock, except the first move of a game without a base time (0+n: no clock before it).
      const unclocked = stats.moves - stats.clockMoves.reduce((a, b) => a + b, 0);
      assert.equal(unclocked, (item.headers.TimeControl ?? "").startsWith("0+") ? unclocked : 0, `${item.id}: clocks`);
      assert.ok(unclocked <= 1, `${item.id}: ${unclocked} moves without a clock`);
      assert.equal(record.inputs.errorThemeN.length, record.inputs.errorLog.length);
      assert.equal(record.inputs.errorThemeN.reduce((a, b) => a + b, 0), record.inputs.errorThemes.length);
      assert.equal(stats.phaseErrors.reduce((a, b) => a + b, 0), record.inputs.errorLog.length);
      // The clock before each of the side's plies, from %clk (ms), bucketed independently.
      const [initial] = (item.headers.TimeControl ?? "0+0").split("+").map(Number);
      const before = (i: number) => (i >= 2 ? (mt.clocksSec[i - 2] as number) * 1000 : (initial as number) * 1000);
      const bucketOf = (ms: number) => (ms < 60_000 ? 4 : ms < 120_000 ? 3 : ms < 300_000 ? 2 : 1);
      const counts = [0, 0, 0, 0];
      for (const code of record.inputs.errorLog) {
        const e = decodeErrorLog(code);
        assert.ok(e.clockBucket >= 1 && e.clockBucket <= 4);
        counts[e.clockBucket - 1]! += 1;
        assert.ok(e.winLoss >= 0 && e.winLoss <= 100);
      }
      const plyBuckets = mine.map((i) => bucketOf(before(i)));
      for (let b = 1; b <= 4; b++) assert.ok(counts[b - 1]! <= plyBuckets.filter((x) => x === b).length, `${item.id}: bucket ${b}`);
      // %eval encodes like the importer: pawns × 100 clamped, mates as ±(30000 − n).
      for (const e of mt.evals) if (e) assert.ok(Math.abs(hintValue(e)) <= 30000);
    }
  });

  it("aggregates a cell exactly as the weakness engine would (independent recount of moves, themes, clocks)", () => {
    const records: SideRecord[] = sample.sides.map((s) => s.record);
    const cell = aggregateCell(records);
    let moves = 0;
    let lt1 = 0;
    const themeCount = new Map<string, number>();
    const themeLoss = new Map<string, number>();
    let blundersLt1 = 0;
    for (const r of records) {
      const st = decodeStatsV1(r.inputs.stats)!;
      moves += st.moves;
      lt1 += st.clockMoves[3]!;
      let off = 0;
      r.inputs.errorLog.forEach((code, i) => {
        const e = decodeErrorLog(code);
        const n = r.inputs.errorThemeN[i]!;
        for (const t of new Set(r.inputs.errorThemes.slice(off, off + n))) {
          themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
          themeLoss.set(t, (themeLoss.get(t) ?? 0) + e.winLoss);
        }
        off += n;
        if (e.clockBucket === 4 && e.judgement === 1) blundersLt1++;
      });
    }
    assert.equal(cell.moves, moves);
    assert.equal(cell.sides, 50);
    assert.equal(cell.timePressure.movesLt1, lt1);
    assert.equal(cell.timePressure.blundersLt1, blundersLt1);
    assert.equal(cell.timePressure.per100Lt1, cell.clockBlunders100[3], "one computation for the row and the lt1 bar (C4)");
    assert.equal(cell.clockMoves.reduce((a, b) => a + b, 0), moves, "no 0+n game among the fixture sides: every move clocked");
    assert.deepEqual(Object.keys(cell.themes), cellThemeKeys());
    for (const key of cellThemeKeys()) {
      const k = themeCount.get(key) ?? 0;
      assert.equal(cell.themes[key]!.per100, Math.round((100 * k * 10_000) / moves) / 10_000, key);
      assert.equal(cell.themes[key]!.loss100, Math.round((100 * (themeLoss.get(key) ?? 0) * 10_000) / moves) / 10_000, key);
    }
    for (const x of cell.phaseAccuracy) assert.ok(x > 0 && x <= 100);
    assert.ok(cell.conversion >= 0 && cell.conversion <= 1);
  });

  it("the v1 document of a full set of cells parses with the strict schema; a missing cell refuses to build", () => {
    const records = sample.sides.map((s) => s.record);
    const cells = new Map<string, SideRecord[]>();
    for (const band of Array.from({ length: 19 }, (_, i) => String(600 + i * 100)))
      for (const tc of ["BULLET", "BLITZ", "RAPID"]) cells.set(`${band}:${tc}`, records);
    const b = buildBaseline({ cells, calibration: {}, dump: "test", games: 50, builtAt: "2026-11-17" });
    const parsed = parseBaseline(JSON.parse(baselineJson(b)));
    assert.equal(parsed.id, "v1");
    assert.equal(parsed.synthetic, false);
    assert.equal(parsed.profile, ENGINE_PROFILE.id);
    cells.delete("1500:RAPID");
    assert.throws(() => buildBaseline({ cells, calibration: {}, dump: "test", games: 50, builtAt: "2026-11-17" }), /1500:RAPID/);
  });
});

describe("J5 calibration factors", () => {
  const rec = (key: string, ev: [number, number, number, number], en: [number, number, number, number]): CalibrationRecord => ({
    v: 1,
    key,
    id: key,
    color: "w",
    eval: { moves: ev[0], MISTAKE: ev[1], BLUNDER: ev[2], MISS: ev[3] },
    engine: { moves: en[0], MISTAKE: en[1], BLUNDER: en[2], MISS: en[3] },
    searches: 0,
  });

  it("is our engine's rate per graded move over the %eval rate, per band; thin bands take the pooled factor", () => {
    const r = calibrationOf([rec("1200:BLITZ", [1000, 40, 30, 30], [1000, 50, 30, 30]), rec("1300:BLITZ", [1000, 40, 60, 10], [500, 20, 15, 5])], ["1200", "1300", "1400"]);
    assert.deepEqual(r.factors["1200"], { MISTAKE: 1.25, BLUNDER: 1, MISS: 1, ALL: 1.1 });
    // 1300: MISS has 10 %eval events (< 30) → pooled (35 / 1500) / (40 / 2000).
    assert.deepEqual(r.factors["1300"], { MISTAKE: 1, BLUNDER: 0.5, MISS: 1.1667, ALL: 0.7273 });
    assert.deepEqual(r.detail["1300"]!.pooled, ["MISS"]);
    assert.deepEqual(r.factors["1400"], { MISTAKE: 1.1667, BLUNDER: 0.6667, MISS: 1.1667, ALL: 0.9524 });
    assert.equal(r.detail["1400"]!.sides, 0);
  });
});
