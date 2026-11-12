// The P3 finish fragment (phase-03 plan §7.4, §7.6) as SQL text and the outcome mapping callers rely on. The real
// statement runs against Postgres in test/finish-p3.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_PRIORITY, analysisEtaSec } from "@repo/contracts/internal/jobs";
import { finishFragments, finishGameSql, type FinishGameInput } from "./finish";
import {
  P3_ANALYSIS_FRAGMENT,
  P3_FINISH_FRAGMENTS,
  analysisEligible,
  finishAnalysisOf,
} from "./finish.fragments.p3";

const base: FinishGameInput = {
  gameId: 42n,
  moves: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6",
  clocksMs: [],
  plyCount: 6,
  fen: "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4",
  whiteTimeMs: null,
  blackTimeMs: null,
  method: "resignation",
  winner: "w",
  pgn: null,
  endedAt: new Date(0),
};

describe("P3 finish fragment", () => {
  it("is part of every finish: finish.ts starts its list with P3_FINISH_FRAGMENTS (no side-effect import)", () => {
    assert.deepEqual(
      finishFragments().map((f) => f.name),
      P3_FINISH_FRAGMENTS.map((f) => f.name),
    );
    const sql = finishGameSql(base).text;
    assert.ok(sql.includes("p3_jobs AS ("), "the job CTE");
    assert.ok(sql.includes(`"analysisStatus" = 'QUEUED'`), "g's SET");
    for (const col of ['AS "analysisQueued"', 'AS "analysisAhead"', 'AS "analysisStatusBefore"']) assert.ok(sql.includes(col), col);
    assert.equal(sql.split(";").length, 1, "still one statement");
    // No second gamesVersion bump: P2's uv CTE is the only one (interface-check §2).
    assert.equal(sql.match(/"gamesVersion" = u\."gamesVersion" \+ 1/g)?.length, 1);
  });

  it("≥ 6 plies: QUEUED and an eligible insert at GAME_ENDED with the analyze:<id> key; < 6: SKIPPED, no insert", () => {
    const queued = finishGameSql(base, [P3_ANALYSIS_FRAGMENT]);
    assert.ok(queued.text.includes(`"analysisStatus" = 'QUEUED'::"AnalysisStatus"`));
    assert.ok(queued.values.includes("analyze:42"));
    assert.ok(queued.values.includes(JOB_PRIORITY.GAME_ENDED));
    assert.match(queued.text, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
    assert.match(queued.text, /'bot_end' ELSE 'live_end'/);
    const short = finishGameSql({ ...base, plyCount: 5, moves: "e2e4 e7e5 g1f3 b8c6 f1b5" }, [P3_ANALYSIS_FRAGMENT]);
    assert.ok(short.text.includes(`"analysisStatus" = 'SKIPPED'::"AnalysisStatus"`));
    // The insert's eligibility guard is a bound boolean: true for 6 plies, false for 5.
    assert.deepEqual(P3_ANALYSIS_FRAGMENT.cte!(base).values.filter((v) => typeof v === "boolean"), [true]);
    assert.deepEqual(P3_ANALYSIS_FRAGMENT.cte!({ ...base, plyCount: 5 }).values.filter((v) => typeof v === "boolean"), [false]);
  });

  it("analysisEligible follows ANALYSIS_MIN_PLIES (6)", () => {
    assert.equal(analysisEligible(5), false);
    assert.equal(analysisEligible(6), true);
    assert.equal(analysisEligible(0), false);
  });

  it("analysisEtaSec: plies × 0.35 s + 5 s pass 2 + 25 s per job ahead, at least 1", () => {
    assert.equal(analysisEtaSec({ ahead: 0, remainingPlies: 40 }), 19);
    assert.equal(analysisEtaSec({ ahead: 2, remainingPlies: 40 }), 69);
    assert.equal(analysisEtaSec({ ahead: 0, remainingPlies: 0 }), 5);
    assert.equal(analysisEtaSec({ ahead: -3, remainingPlies: -1 }), 5);
  });
});

describe("finishAnalysisOf", () => {
  const extra = (queued: number, ahead: number, before: string) => ({
    analysisQueued: queued,
    analysisAhead: ahead,
    analysisStatusBefore: before,
  });

  it("a fresh finish: queued with an ETA and a kick; a short one: skipped, no kick", () => {
    assert.deepEqual(finishAnalysisOf({ finished: true, extra: extra(1, 1, "NONE") }, 40), {
      review: { status: "queued", etaSec: analysisEtaSec({ ahead: 1, remainingPlies: 40 }) },
      status: "QUEUED",
      created: true,
      ahead: 1,
      kick: true,
    });
    assert.deepEqual(finishAnalysisOf({ finished: true, extra: extra(0, 0, "NONE") }, 4), {
      review: { status: "skipped", etaSec: null },
      status: "SKIPPED",
      created: false,
      ahead: 0,
      kick: false,
    });
  });

  it("a replayed finish answers the stored state; only a still-QUEUED job is kicked again", () => {
    const queued = finishAnalysisOf({ finished: false, extra: extra(0, 0, "QUEUED") }, 40)!;
    assert.equal(queued.review.status, "queued");
    assert.equal(queued.kick, true);
    assert.equal(queued.created, false);
    for (const stored of ["RUNNING", "DONE", "FAILED"]) {
      const r = finishAnalysisOf({ finished: false, extra: extra(0, 0, stored) }, 40)!;
      assert.deepEqual(r.review, { status: "queued", etaSec: null }, stored);
      assert.equal(r.kick, false, stored);
    }
    for (const stored of ["SKIPPED", "NONE", "garbage"]) {
      const r = finishAnalysisOf({ finished: false, extra: extra(0, 0, stored) }, 40)!;
      assert.deepEqual(r.review, { status: "skipped", etaSec: null }, stored);
      assert.equal(r.kick, false, stored);
    }
  });

  it("drivers may return counts as bigint or string", () => {
    const r = finishAnalysisOf({ finished: true, extra: { analysisQueued: 1n, analysisAhead: "3", analysisStatusBefore: "NONE" } }, 10)!;
    assert.equal(r.created, true);
    assert.equal(r.ahead, 3);
  });

  it("null without the P3 columns (a finish built without the fragment)", () => {
    assert.equal(finishAnalysisOf({ finished: true, extra: {} }, 40), null);
  });
});
