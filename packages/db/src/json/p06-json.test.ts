// The P6 JSON column shape (phase-06 plan 6.3): weakness_snapshots.metrics. The writer validator accepts what the
// engine actually produces (computeWeakness over the per-side inputs of 62 real CC0 Lichess games, and the FAILED
// document), the reader is lenient (null, never a throw) and the strict objects refuse what a build must not store.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cc0Game, cc0TimedIndexes } from "@repo/chess-analysis/fixtures/weakness-inputs";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { WEAKNESS_INPUTS_VERSION, computeSideInputs } from "@repo/chess-analysis/weakness-inputs";
import { loadBaseline } from "@repo/chess-training/baselines/load";
import { computeWeakness, failedMetrics } from "@repo/chess-training/weakness/compute";
import { resolveScope, scopeSince } from "@repo/chess-training/weakness/scope";
import type { WeaknessGameInput, WeaknessMetricsV1 as EngineMetrics } from "@repo/chess-training/weakness/types";
import { WeaknessMetricsV1 as ContractMetrics } from "@repo/contracts/internal/weakness-metrics";
import {
  WEAKNESS_STATUSES_DB,
  WEAKNESS_STATUSES_WRITTEN,
  WeaknessMetricsV1,
  buildWeaknessMetrics,
  parseWeaknessMetrics,
} from "./index";

const NOW = new Date("2026-11-17T19:00:00.000Z");
const DAY = 86_400_000;

/** One member's side of each real game (alternating colours), as the worker's Q-W5 row with its inputs computed. */
function memberInputs(): WeaknessGameInput[] {
  return cc0TimedIndexes().map((index, k) => {
    const g = cc0Game(index);
    const color = k % 2 === 0 ? "w" : "b";
    const result = !g.winner ? "DRAW" : (g.winner === "white") === (color === "w") ? "WIN" : "LOSS";
    const graded = gradeAnalysis({ ...g.input, members: [{ side: color, result: result === "WIN" ? "win" : result === "LOSS" ? "loss" : "draw" }] });
    const inputs = computeSideInputs(
      { startingFen: g.input.startFen, startPly: 0, moves: g.input.moves, moveClocksMs: g.moveClocksMs, initialTimeSeconds: g.initialTimeSeconds, timeClass: g.timeClass },
      {
        evals: g.input.evals,
        best: g.input.best,
        judgements: graded.judgements,
        lines: graded.lines,
        middlegamePly: graded.division.middlegamePly,
        endgamePly: graded.division.endgamePly,
      },
      { color, result },
    );
    return {
      gameId: String(1000 + index),
      color,
      endedAt: new Date(NOW.getTime() - (k + 1) * 2.3 * DAY),
      timeClass: g.timeClass as WeaknessGameInput["timeClass"],
      mode: "IMPORTED",
      result,
      ratingBefore: 1480 + (k % 7) * 9,
      rated: true,
      source: "LICHESS",
      oppTitle: null,
      ecoCode: g.eco,
      accuracy: graded.accuracy[color],
      phaseAccuracy: graded.phaseAccuracy[color],
      ...inputs,
      weaknessInputsV: WEAKNESS_INPUTS_VERSION,
      evalSource: "LICHESS",
    };
  });
}

describe("WeaknessMetricsV1", () => {
  it("accepts the engine's real output and the FAILED document, field for field", () => {
    // One schema: the column's validator is the contract's, and the engine's output type is inferred from it.
    assert.equal(WeaknessMetricsV1, ContractMetrics);
    const baseline = loadBaseline();
    const draft = computeWeakness(memberInputs(), baseline, { now: NOW, timeZone: "Asia/Kolkata", profile: null, ratingBand: "R1200_1600" });
    assert.ok(draft.gamesAnalysed >= 20, `${draft.gamesAnalysed} analysed games in scope`);
    assert.equal(draft.status, "READY");
    const typed: WeaknessMetricsV1 = draft.metrics satisfies EngineMetrics;
    assert.ok(typed);
    // A JSON round trip first: what the column stores is JSON, not the in-memory object.
    const stored = JSON.parse(JSON.stringify(draft.metrics)) as unknown;
    assert.deepEqual(buildWeaknessMetrics(stored), stored);
    assert.ok(Buffer.byteLength(JSON.stringify(stored)) < 16_000, "the document stays a few KB");

    const scope = resolveScope(null);
    const failed = failedMetrics({ code: "inputs_corrupt", at: NOW, scope, since: scopeSince(NOW, "UTC", scope.months), inScope: 22, analysed: 22, baseline });
    assert.deepEqual(buildWeaknessMetrics(JSON.parse(JSON.stringify(failed))), JSON.parse(JSON.stringify(failed)));
  });

  it("the reader returns null, never throws, for a row it cannot read", () => {
    assert.equal(parseWeaknessMetrics(null), null);
    assert.equal(parseWeaknessMetrics({ v: 2 }), null);
    assert.equal(parseWeaknessMetrics("{}"), null);
  });

  it("strict objects refuse extra keys, a sixth row, bad enums and live fields", () => {
    const draft = computeWeakness(memberInputs(), loadBaseline(), { now: NOW, timeZone: "UTC", profile: null, ratingBand: null });
    const doc = JSON.parse(JSON.stringify(draft.metrics)) as Record<string, unknown> & { rows: unknown[]; scope: Record<string, unknown> };
    assert.ok(WeaknessMetricsV1.safeParse(doc).success);
    assert.equal(WeaknessMetricsV1.safeParse({ ...doc, status: "READY" }).success, false, "status is derived, never stored");
    assert.equal(WeaknessMetricsV1.safeParse({ ...doc, progress: {} }).success, false);
    assert.equal(WeaknessMetricsV1.safeParse({ ...doc, scope: { ...doc.scope, months: 4 } }).success, false);
    assert.equal(WeaknessMetricsV1.safeParse({ ...doc, listMode: "top" }).success, false);
    if (doc.rows.length > 0) {
      const six = Array.from({ length: 6 }, () => doc.rows[0]);
      assert.equal(WeaknessMetricsV1.safeParse({ ...doc, rows: six }).success, false);
      assert.equal(WeaknessMetricsV1.safeParse({ ...doc, rows: [{ ...(doc.rows[0] as object), slug: "x" }] }).success, false);
    }
    assert.throws(() => buildWeaknessMetrics({ ...doc, v: 2 }));
  });

  it("names the DB enum and the statuses a row is written with", () => {
    assert.deepEqual([...WEAKNESS_STATUSES_DB], ["INSUFFICIENT", "COMPUTING", "READY", "FAILED"]);
    assert.ok(!(WEAKNESS_STATUSES_WRITTEN as readonly string[]).includes("COMPUTING"));
  });
});
