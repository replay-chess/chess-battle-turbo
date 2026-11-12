// Phase 3 cross-package parity (phase-03 plan 6.6, 8.1, 8.16, 13.1): the grading library (@repo/chess-analysis)
// cannot import the contracts or the DB schemas, and the contracts cannot import the library, so the places where
// they must agree are pinned here, in the one package that depends on all three:
//   - the JudgementCode table: wire keys and `j` chars (CA codec ↔ CT review);
//   - the `analysis:progress` frame ↔ the review payload (CA `mergePlies` ↔ CT `AnalysisProgressEvent`/`ReviewDTO`);
//   - what the worker writes (CA `gradeAnalysis`) ↔ the JSON column schemas (DB `ReviewContentV1`, `LinesV1`);
//   - legend facts and texts (CA `compareWithLegend`/`legendSummary`/`lineRows`) ↔ DB `ComparisonFactsV1` and
//     CT `LegendSummaryDTO`/`LegendLine`;
//   - the share-code alphabet (DB ↔ CT).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { JUDGEMENT_CHARS, JUDGEMENT_KEYS as CA_JUDGEMENT_KEYS, deltaFit, mergePlies } from "@repo/chess-analysis/codec";
import { legendFixtureFacts, loadLegendFixtures, LEGEND_FIXTURE_REF } from "@repo/chess-analysis/fixtures/legend";
import { REVIEW_INPUTS } from "@repo/chess-analysis/fixtures/review-inputs";
import { legendSummary, lineRows } from "@repo/chess-analysis/legend/summary";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import { LegendLine, legendComparePath } from "@repo/contracts/http/legend";
import {
  J_CHARS,
  JUDGEMENT_CODE_COUNT,
  JUDGEMENT_KEYS as CT_JUDGEMENT_KEYS,
  LegendSummaryDTO,
  PLAN_KEYS as CT_PLAN_KEYS,
  ReviewDTO,
} from "@repo/contracts/http/review";
import { ShareCode as CtShareCode, SHARE_CODE_ALPHABET } from "@repo/contracts/http/share";
import { AnalysisProgressEvent } from "@repo/contracts/socket/analysis";
import { analysisEventFixtures } from "@repo/contracts/socket/fixtures/analysis";
import {
  ComparisonFactsV1,
  LinesV1,
  PLAN_KEYS as DB_PLAN_KEYS,
  ReviewContentV1,
  ShareCode as DbShareCode,
} from "@repo/db/json";

describe("P3 parity: JudgementCode table", () => {
  it("CA and CT list the same wire keys in the same (code) order", () => {
    assert.deepEqual([...CA_JUDGEMENT_KEYS], [...CT_JUDGEMENT_KEYS]);
    assert.equal(CT_JUDGEMENT_KEYS.length + 1, JUDGEMENT_CODE_COUNT);
  });

  it("CA and CT use the same `j` chars", () => {
    assert.equal(JUDGEMENT_CHARS, J_CHARS);
    assert.equal(J_CHARS.length, JUDGEMENT_CODE_COUNT);
  });

  it("DB and CT list the same plan chips", () => {
    assert.deepEqual([...DB_PLAN_KEYS], [...CT_PLAN_KEYS]);
  });
});

describe("P3 parity: analysis:progress frame ↔ review payload", () => {
  const progress = analysisEventFixtures()["analysis:progress"];

  it("the fixture frame is a valid AnalysisProgressEvent", () => {
    AnalysisProgressEvent.parse(progress);
  });

  it("a running review splices the frame and still parses as a ReviewDTO", () => {
    const running = reviewFixture("running");
    assert.ok(running.analysis);
    const behind = { ...running, analysis: { ...running.analysis, gradedPlies: progress.from } };
    assert.equal(deltaFit(behind, progress), "apply");
    const merged = mergePlies(behind, progress);
    assert.notEqual(merged, behind);
    assert.equal(merged.status, "running");
    assert.equal(merged.analysis?.gradedPlies, progress.gradedPlies);
    assert.equal(merged.analysis?.j.slice(progress.from, progress.gradedPlies), progress.j);
    ReviewDTO.parse(merged);
  });

  it("a queued review carries a skeleton analysis, so the first frame applies instead of forcing a refetch", () => {
    const queued = reviewFixture("queued");
    assert.ok(queued.analysis, "queued ReviewDTO.analysis must be a skeleton, not null");
    assert.equal(queued.analysis.gradedPlies, 0);
    const first = { ...progress, from: 0, gradedPlies: 2, evals: [15, 20], best: "e2e4 e7e5", j: "kk" };
    AnalysisProgressEvent.parse(first);
    assert.equal(deltaFit(queued, first), "apply");
    const merged = mergePlies(queued, first);
    assert.equal(merged.status, "running");
    assert.equal(merged.analysis?.queue, null);
    ReviewDTO.parse(merged);
  });

  it("a done or no-job review is closed to frames", () => {
    assert.equal(deltaFit(reviewFixture("done"), progress), "closed");
    assert.equal(deltaFit(reviewFixture("none"), progress), "closed");
  });
});

describe("P3 parity: worker output ↔ JSON column schemas", () => {
  for (const [name, input] of Object.entries(REVIEW_INPUTS)) {
    it(`${name}: every review parses as ReviewContentV1 and the lines as LinesV1`, () => {
      const result = gradeAnalysis(input());
      const sides = Object.values(result.reviews);
      assert.ok(sides.length > 0);
      for (const review of sides) ReviewContentV1.parse(review);
      LinesV1.parse(result.lines);
      for (const side of ["w", "b"] as const) assert.equal(result.counts[side].length, JUDGEMENT_CODE_COUNT);
    });
  }
});

describe("P3 parity: legend facts and texts ↔ DB and CT schemas", () => {
  for (const fixture of loadLegendFixtures()) {
    it(`${fixture.name}: facts parse as ComparisonFactsV1; summary and lines parse as the DTOs`, () => {
      const facts = legendFixtureFacts(fixture);
      ComparisonFactsV1.parse(facts);
      const ctx = { startFen: fixture.startFen, facts };
      LegendSummaryDTO.parse({
        status: "facts_ready",
        compareHref: legendComparePath(LEGEND_FIXTURE_REF),
        ...legendSummary(ctx, LEGEND_FIXTURE_REF, fixture.userResult),
      });
      LegendLine.parse({ uci: facts.userLineUci, rows: lineRows(ctx, "yours") });
      LegendLine.parse({ uci: facts.legendLineUci, rows: lineRows(ctx, "legend") });
    });
  }
});

describe("P3 parity: share codes", () => {
  it("DB and CT accept exactly the same 8-char codes", () => {
    for (const c of SHARE_CODE_ALPHABET) {
      const code = c.repeat(8);
      assert.equal(DbShareCode.safeParse(code).success, true, code);
      assert.equal(CtShareCode.safeParse(code).success, true, code);
    }
    for (const c of "ilou_-A") {
      const code = c.repeat(8);
      assert.equal(DbShareCode.safeParse(code).success, false, code);
      assert.equal(CtShareCode.safeParse(code).success, false, code);
    }
  });
});
