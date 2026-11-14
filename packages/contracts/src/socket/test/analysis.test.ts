// Phase-03 plan §5.11 (P3-D13, P3-D26): the analysis user-room events parse, refuse inconsistent deltas, keep their
// byte budgets with worst-case payloads, use names the emit endpoint and the `wk` allow-list admit, and tolerate the
// `useq` stamp the socket server adds on delivery.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kidMayEmit } from "../../internal/auth";
import {
  ANALYSIS_BATCH_MAX_REFS,
  ANALYSIS_EVENT_BUDGETS,
  ANALYSIS_EVENT_NAMES,
  ANALYSIS_EVENTS,
  analysisDoneDedupeKey,
  AnalysisProgressEvent,
  AnalysisWritingEvent,
  GameResultReview,
  PROGRESS_FRAME_MAX_PLIES,
  WRITING_STEPS_MAX,
} from "../analysis";
import { analysisEventFixtures, worstAnalysisEventFixtures } from "../fixtures/analysis";
import { EmitBody } from "../internal";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

describe("analysis events: schemas", () => {
  it("every typical and worst-case fixture parses with its schema", () => {
    for (const fixtures of [analysisEventFixtures(), worstAnalysisEventFixtures()]) {
      for (const name of ANALYSIS_EVENT_NAMES) {
        const r = ANALYSIS_EVENTS[name].safeParse(fixtures[name]);
        assert.equal(r.success, true, `${name}: ${r.success ? "" : r.error.message}`);
      }
    }
  });

  it("registers exactly the eight §5.11 events", () => {
    assert.deepEqual([...ANALYSIS_EVENT_NAMES].sort(), [
      "analysis:batch", "analysis:done", "analysis:failed", "analysis:progress", "analysis:queued", "analysis:writing",
      "compare:ready", "games:changed",
    ]);
  });

  it("every payload carries v: 1 and refuses another version", () => {
    const fixtures = analysisEventFixtures();
    for (const name of ANALYSIS_EVENT_NAMES) {
      assert.equal((fixtures[name] as { v: number }).v, 1, name);
      assert.equal(ANALYSIS_EVENTS[name].safeParse({ ...fixtures[name], v: 2 }).success, false, name);
    }
  });

  it("tolerates the delivery stamp `useq` (the socket adds it after validation)", () => {
    const fixtures = analysisEventFixtures();
    for (const name of ANALYSIS_EVENT_NAMES) {
      assert.equal(ANALYSIS_EVENTS[name].safeParse({ ...fixtures[name], useq: 4_812 }).success, true, name);
    }
  });

  it("analysis:writing carries pass 2's progress (`at` of the planned searches), together or not at all (dev pass D3)", () => {
    const ref = "c947f1cda7cc1e50f81edbcef";
    assert.ok(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref }).success);
    assert.ok(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref, at: 0, of: 4 }).success);
    assert.ok(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref, at: 4, of: 4 }).success);
    assert.equal(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref, at: 5, of: 4 }).success, false);
    assert.equal(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref, at: 1 }).success, false);
    assert.equal(AnalysisWritingEvent.safeParse({ v: 1, gameRef: ref, at: 0, of: WRITING_STEPS_MAX + 1 }).success, false);
  });

  it("analysis:done reserves bank as null (P5 fills it) and caps the coach line at 160", () => {
    const done = analysisEventFixtures()["analysis:done"];
    assert.equal(ANALYSIS_EVENTS["analysis:done"].safeParse({ ...done, bank: { added: 2, plies: [32, 36], due: 1 } }).success, false);
    assert.equal(ANALYSIS_EVENTS["analysis:done"].safeParse({ ...done, coachLine: "x".repeat(161) }).success, false);
    assert.equal(ANALYSIS_EVENTS["analysis:done"].safeParse({ ...done, momentsCount: 4 }).success, false);
  });

  it("analysis:failed takes only the four failure codes", () => {
    const failed = analysisEventFixtures()["analysis:failed"];
    for (const code of ["engine_failed", "worker_stalled", "timeout", "internal"]) {
      assert.equal(ANALYSIS_EVENTS["analysis:failed"].safeParse({ ...failed, code }).success, true, code);
    }
    assert.equal(ANALYSIS_EVENTS["analysis:failed"].safeParse({ ...failed, code: "crashed" }).success, false);
  });

  it("P5: analysis:done keeps bank null and carries bankAdded {count, plies ≤ 4} and bankDue, both optional", () => {
    const done = analysisEventFixtures()["analysis:done"];
    const schema = ANALYSIS_EVENTS["analysis:done"];
    assert.equal(schema.safeParse(done).success, true);
    const { bankAdded: _a, bankDue: _d, ...p3Frame } = done;
    assert.equal(schema.safeParse(p3Frame).success, true, "a P3 worker's frame (no bank fields) still parses");
    assert.equal(schema.safeParse({ ...done, bankAdded: null, bankDue: null }).success, true, "lost batch response → null");
    assert.equal(schema.safeParse({ ...done, bankAdded: { count: 1, plies: [1, 2, 3, 4, 5] } }).success, false);
    assert.equal(schema.safeParse({ ...done, bankAdded: { count: -1, plies: [] } }).success, false);
    assert.equal(schema.safeParse({ ...done, bankDue: -1 }).success, false);
    const batch = analysisEventFixtures()["analysis:batch"];
    assert.equal(ANALYSIS_EVENTS["analysis:batch"].safeParse(batch).success, true);
    const { bankAdded: _b, bankDue: _e, ...p3Batch } = batch;
    assert.equal(ANALYSIS_EVENTS["analysis:batch"].safeParse(p3Batch).success, true);
    assert.equal(ANALYSIS_EVENTS["analysis:batch"].safeParse({ ...batch, bankAdded: 1.5 }).success, false);
  });

  it("analysis:batch carries at most 20 refs, and only refs", () => {
    const batch = worstAnalysisEventFixtures()["analysis:batch"];
    assert.equal(batch.refs.length, ANALYSIS_BATCH_MAX_REFS);
    assert.equal(ANALYSIS_EVENTS["analysis:batch"].safeParse({ ...batch, refs: [...batch.refs, batch.refs[0]] }).success, false);
    assert.equal(ANALYSIS_EVENTS["analysis:batch"].safeParse({ ...batch, refs: ["42"] }).success, false);
  });

  it("games:changed may omit the game", () => {
    assert.equal(ANALYSIS_EVENTS["games:changed"].safeParse({ v: 1 }).success, true);
  });
});

describe("analysis:progress deltas", () => {
  const ok = analysisEventFixtures()["analysis:progress"];
  const parse = (over: Record<string, unknown>) => AnalysisProgressEvent.safeParse({ ...ok, ...over }).success;

  it("needs one judgement and one best move per new ply", () => {
    assert.equal(parse({}), true);
    assert.equal(parse({ j: "I" }), false);
    assert.equal(parse({ best: "d1c1" }), false);
    assert.equal(parse({ best: "d1c1 - " }), false, "no trailing space");
    assert.equal(parse({ best: "d1c1 -" }), true, "unknown best move is -");
  });

  it("refuses from > gradedPlies, gradedPlies > totalPlies and more evals than new positions", () => {
    assert.equal(parse({ from: 35, gradedPlies: 34 }), false);
    assert.equal(parse({ gradedPlies: 34, totalPlies: 33 }), false);
    assert.equal(parse({ evals: [1, 2, 3, 4] }), false);
    assert.equal(parse({ evals: [] }), true);
    assert.equal(parse({ evals: [12, -137, -140] }), true, "plies + 1 when the start position is new too");
  });

  it(`never carries more than ${PROGRESS_FRAME_MAX_PLIES} plies`, () => {
    const n = PROGRESS_FRAME_MAX_PLIES + 1;
    assert.equal(parse({ from: 0, gradedPlies: n, j: "b".repeat(n), best: Array(n).fill("e2e4").join(" "), evals: [] }), false);
  });

  it("refuses j characters outside the judgement alphabet and evals outside the mate range", () => {
    assert.equal(parse({ j: "Iz" }), false);
    assert.equal(parse({ evals: [30_001, 0] }), false);
    assert.equal(parse({ evals: [1.5, 0] }), false);
  });
});

describe("analysis events: budgets and the emit path", () => {
  it("every worst-case payload stays within its §5.11 budget", () => {
    const worst = worstAnalysisEventFixtures();
    const report: string[] = [];
    for (const name of ANALYSIS_EVENT_NAMES) {
      const size = bytes(worst[name]);
      if (size > ANALYSIS_EVENT_BUDGETS[name]) report.push(`${name}: ${size} B > ${ANALYSIS_EVENT_BUDGETS[name]} B`);
    }
    assert.deepEqual(report, []);
  });

  it("the budgets are the plan's, except the four measured clarifications (done, failed, batch, compare:ready)", () => {
    assert.deepEqual(ANALYSIS_EVENT_BUDGETS, {
      "analysis:queued": 80, "analysis:progress": 400, "analysis:writing": 60, "analysis:done": 480,
      "analysis:failed": 192, "analysis:batch": 672, "compare:ready": 64, "games:changed": 60,
    });
    // The clarifications are real: the plan's figure cannot hold the worst case.
    const worst = worstAnalysisEventFixtures();
    assert.ok(bytes(worst["analysis:done"]) > 440, "P5: the bank fields are in the worst case");
    assert.ok(bytes(worst["analysis:failed"]) > 160);
    assert.ok(bytes(worst["analysis:batch"]) > 640, "P5: the bank fields are in the worst case");
    assert.ok(bytes(worst["compare:ready"]) > 60);
  });

  it("each event fits the /internal/emit body (name pattern) and the worker's allow-list", () => {
    const fixtures = analysisEventFixtures();
    for (const name of ANALYSIS_EVENT_NAMES) {
      const body = { v: 1, targets: [{ userRef: "cm1a7rt0q0002ls8d9x0k4vze" }], event: name, data: fixtures[name], dedupeKey: "done:42:1:w" };
      assert.equal(EmitBody.safeParse(body).success, true, name);
      assert.equal(kidMayEmit("wk", name), true, name);
    }
  });

  it("analysis:done dedupe keys are per game, grading version and side", () => {
    assert.equal(analysisDoneDedupeKey(42n, 1, "w"), "done:42:1:w");
    assert.equal(analysisDoneDedupeKey("42", 2, "b"), "done:42:2:b");
    assert.notEqual(analysisDoneDedupeKey(42, 1, "w"), analysisDoneDedupeKey(42, 1, "b"));
  });

  it("game:result.review widens to queued/skipped with an ETA", () => {
    assert.equal(GameResultReview.safeParse({ status: "queued", etaSec: 20 }).success, true);
    assert.equal(GameResultReview.safeParse({ status: "skipped", etaSec: null }).success, true);
    assert.equal(GameResultReview.safeParse({ status: "none" }).success, false);
  });
});
