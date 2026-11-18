// The engine on real games through the real CPU pipeline (owner's rule, 2026-11-17: real data, not hand-made JSON).
// Every CC0 Lichess game of the import pool with a full eval and clock record (`@repo/chess-fixtures/import/source/
// cc0-pool.json`) is graded by the worker's grader (`gradeAnalysis`, Lichess evals, the export's opening length as
// book), turned into the five `game_players` inputs by `computeSideInputs` (CA, the worker's final-batch builder), and
// handed to `computeWeakness` as one member's history. The assertions recompute every aggregate the profile shows
// from the stored records independently, so the engine's numbers are checked against real clocks, phases, accuracies,
// openings and Win% losses — not against values it produced itself. (The Postgres path — import, worker analysis,
// extraction, the recompute job — is WP4/WP8's integration and e2e layer.)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { decodeErrorLog, decodeStatsV1 } from "@repo/chess-analysis/codec";
import { ecoFamily } from "@repo/chess-analysis/eco-families";
import { cc0Case, cc0Game, cc0TimedIndexes } from "@repo/chess-analysis/fixtures/weakness-inputs";
import { computeSideInputs, WEAKNESS_INPUTS_VERSION } from "@repo/chess-analysis/weakness-inputs";
import { WEAKNESS_PAYLOAD_MAX_BYTES, WeaknessPayload } from "@repo/contracts/http/weakness";
import { loadBaseline } from "../../baselines/load";
import { computeWeakness } from "./compute";
import { verifyHeadline } from "./headline";
import { buildPayload } from "./payload";
import type { DbTimeClass, WeaknessGameInput } from "./types";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const HOUR = 3_600_000;

/** One side of each usable CC0 game as a member's `game_players` row (White on even indexes, Black on odd). */
function realRows(): WeaknessGameInput[] {
  return cc0TimedIndexes().map((index, k) => {
    const color = index % 2 === 0 ? "w" : "b";
    const c = cc0Case(index, color);
    const g = cc0Game(index);
    const graded = gradeAnalysis({ ...g.input, members: [{ side: color, result: c.side.result === "WIN" ? "win" : c.side.result === "LOSS" ? "loss" : "draw" }] });
    const inputs = computeSideInputs(c.game, c.analysis, c.side);
    return {
      gameId: String(700_000 + index),
      color,
      endedAt: new Date(NOW.getTime() - (6 + 17 * k) * HOUR),
      timeClass: g.timeClass as DbTimeClass | null,
      mode: "IMPORTED",
      result: c.side.result,
      ratingBefore: null,
      rated: true,
      source: "LICHESS",
      oppTitle: null,
      ecoCode: g.eco,
      accuracy: graded.accuracy[color],
      phaseAccuracy: graded.phaseAccuracy[color],
      stats: inputs.stats,
      errorLog: inputs.errorLog,
      errorThemeN: inputs.errorThemeN,
      errorThemes: inputs.errorThemes,
      weaknessInputsV: WEAKNESS_INPUTS_VERSION,
      evalSource: "LICHESS",
    } satisfies WeaknessGameInput;
  });
}

describe("computeWeakness on real CC0 games (graded and encoded by the worker's code)", () => {
  const rows = realRows();
  const inScope = rows.filter((r) => r.timeClass === "BLITZ" || r.timeClass === "RAPID");
  const analysed = inScope.filter((r) => r.accuracy !== null);
  const draft = computeWeakness(rows, loadBaseline("v0-synthetic"), { now: NOW, timeZone: "Europe/Berlin", profile: null, ratingBand: "R1200_1600" });
  const m = draft.metrics;

  it("uses enough real games for a full profile, and only the in-scope ones (no bullet, no correspondence)", () => {
    assert.ok(rows.length >= 40, `${rows.length} usable CC0 games`);
    assert.ok(analysed.length >= 20);
    assert.equal(draft.status, "READY");
    assert.deepEqual(m.games, { inScope: inScope.length, analysed: analysed.length, excludedBot: 0 });
    assert.equal(m.band?.source, "onboarding");
  });

  it("the clock buckets equal the stored STATS_V1 and ERROR_LOG_V1 records, summed independently", () => {
    const moves = [0, 0, 0, 0];
    const blunders = [0, 0, 0, 0];
    for (const r of analysed) {
      const s = decodeStatsV1(r.stats)!;
      s.clockMoves.forEach((x, i) => (moves[i] = moves[i]! + x));
      for (const code of r.errorLog) {
        const e = decodeErrorLog(code);
        if (e.judgement === 1 && e.clockBucket > 0) blunders[e.clockBucket - 1] = blunders[e.clockBucket - 1]! + 1;
      }
    }
    const clock = m.breakdown!.clock;
    assert.ok(clock, "real Lichess games carry clocks");
    assert.deepEqual(clock.buckets.map((b) => b.moves), moves);
    assert.deepEqual(clock.buckets.map((b) => b.blunders), blunders);
    for (const b of clock.buckets) assert.equal(b.per100, b.moves >= 30 ? Math.round((1000 * b.blunders) / b.moves) / 10 : null, b.key);
  });

  it("the phase accuracies are the move-weighted means of the graded phases", () => {
    for (const [p, row] of m.breakdown!.phase.entries()) {
      let num = 0;
      let den = 0;
      for (const r of analysed) {
        const acc = r.phaseAccuracy[p]!;
        const n = decodeStatsV1(r.stats)!.phaseMoves[p]!;
        if (acc < 0 || n < 3) continue;
        num += acc * n;
        den += n;
      }
      assert.equal(row.moves, den, row.phase);
      assert.equal(row.you, den >= 60 ? Math.round(num / den) : null, row.phase);
    }
  });

  it("the openings table groups every in-scope game by family, with the real results", () => {
    const fams = new Map<string, { games: number; points: number }>();
    for (const r of inScope) {
      const f = ecoFamily(r.ecoCode);
      if (!f || !r.result) continue;
      const x = fams.get(f.name) ?? { games: 0, points: 0 };
      x.games += 1;
      x.points += r.result === "WIN" ? 1 : r.result === "DRAW" ? 0.5 : 0;
      fams.set(f.name, x);
    }
    for (const o of m.breakdown!.openings) {
      assert.deepEqual({ games: o.games, points: o.points }, fams.get(o.family), o.family);
      assert.equal(o.scorePct, Math.round((100 * o.points) / o.games));
    }
    const shown = new Set(m.breakdown!.openings.map((o) => o.family));
    for (const [name, x] of fams) {
      if (shown.has(name) || x.games < 3) continue;
      assert.ok(m.breakdown!.openings.length === 4 && m.breakdown!.openings.every((o) => o.games >= x.games), `${name} (${x.games}) should be listed`);
    }
  });

  it("every row's rate is its events over its moves; the headline verifies; the payload parses under 8 KB", () => {
    const M = analysed.reduce((s, r) => s + decodeStatsV1(r.stats)!.moves, 0);
    for (const row of m.rows) {
      assert.equal(row.moves, row.unit === "per100" ? M : m.breakdown!.clock!.buckets[3]!.moves, row.pattern);
      assert.ok(Math.abs(row.you - (100 * row.events) / row.moves) < 1e-9, row.pattern);
    }
    assert.ok(verifyHeadline(m));
    const payload = buildPayload({
      now: NOW,
      timeZone: "Europe/Berlin",
      snapshot: { weekStart: "2026-11-16", algoVersion: 1, status: draft.status, gamesInScope: draft.gamesInScope, gamesAnalysed: draft.gamesAnalysed, metrics: m, computedAt: NOW },
      profile: null,
      inBank: {},
      probe: { recompute: "none", lastJobFailed: false, activeAnalyzeJobs: 0, games: null, importRun: null, lastAnalysedAt: null },
      isTrialing: false,
      secPerGame: 45,
      lanes: 1,
    });
    assert.equal(WeaknessPayload.safeParse(payload).success, true);
    assert.ok(JSON.stringify(payload).length < WEAKNESS_PAYLOAD_MAX_BYTES);
  });
});
