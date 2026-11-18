// `rc:timePressure` on bank mistakes (phase-06 plan §8.12; interface check §0.13): the shared extraction (worker J1,
// EXTRACT_MISTAKES, the web's A6) tags a mistake when the member had under a minute before the error ply, by the ONE
// clock rule of CA clock.ts (`isTimePressure`: the mover's time two plies earlier, the initial time for the first move;
// none for untimed, DAILY or UNTIMED games). The tag is never primary, and the occurrence carries the flag the worker's
// recount unions into an existing row. Fixture: P3's design GAME (its three key moments), graded by CA.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { isTimePressure } from "@repo/chess-analysis/clock";
import { GAME_MOMENTS, mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { replaySan } from "@repo/chess-analysis/replay";
import { buildBankPlan, type ExtractInput } from "./extract";
import { TIME_PRESSURE_THEME } from "./themes";

const NOW = new Date("2026-11-12T19:00:00.000Z");
const gi = mockGradeInput("GAME");
const lines: Record<number, { pv: string[]; accept: string[] }> = {};
for (const m of GAME_MOMENTS) {
  const line = replaySan(m.lineStart, m.line).uci;
  lines[m.ply] = { pv: line, accept: [line[0]!] };
}
const result = gradeAnalysis({
  startFen: INITIAL_FEN,
  startPly: 0,
  moves: gi.replay.uci,
  evals: gi.evals,
  second: gi.second ?? [],
  best: gi.best ?? [],
  lines,
  isBook: gi.isBook,
  members: [{ side: "w", result: "loss" }],
});

function input(over: Partial<ExtractInput> = {}): ExtractInput {
  return {
    gameId: "900",
    startPly: 0,
    replay: gi.replay,
    evals: gi.evals,
    second: gi.second ?? [],
    best: gi.best ?? [],
    judgements: result.judgements,
    lines: result.lines,
    division: result.division,
    moments: { w: (result.reviews.w?.moments ?? []).map((m) => m.ply) },
    members: [{ color: "w", userId: "41", userRef: "cuserwhite000000000000001" }],
    completedAtMs: Date.parse("2026-11-12T18:40:00Z"),
    timeClass: "BLITZ",
    ecoCode: "C50",
    colorUnknown: false,
    now: NOW,
    ...over,
  };
}

const deps = { search: null, reply: null, newRef: (ms: number) => `cref${ms.toString(36)}${Math.random().toString(36).slice(2, 10)}` };
const meta = { source: "live" as const, clockMs: () => NOW.getTime() };

describe("rc:timePressure in the bank extraction (§8.12)", () => {
  const n = gi.replay.uci.length;
  const pressured = GAME_MOMENTS[0]!.ply;
  // Five minutes on both clocks, except the member's clock before the first key moment: 42 s.
  const moveClocksMs = Array.from({ length: n }, (_, i) => (i === pressured - 2 ? 42_000 : 300_000));

  it("tags exactly the mistakes played with under a minute (the CA clock rule), never as the primary theme", async () => {
    const plain = await buildBankPlan(input(), deps, meta);
    const timed = await buildBankPlan(input({ moveClocksMs, initialTimeSeconds: 300 }), deps, meta);
    assert.ok(timed.mistakes.length >= 3);
    const game = { moveClocksMs, initialTimeSeconds: 300, timeClass: "BLITZ" };
    for (const o of timed.occurrences) {
      const m = timed.mistakes.find((x) => x.epdHash === o.epdHash)!;
      const want = isTimePressure(game, o.ply);
      assert.equal(o.timePressure, want, `occurrence at ply ${o.ply}`);
      if (timed.occurrences.filter((x) => x.epdHash === o.epdHash).length === 1) {
        assert.equal(m.themes.includes(TIME_PRESSURE_THEME), want, `mistake at ply ${o.ply}`);
      }
    }
    assert.ok(timed.occurrences.some((o) => o.ply === pressured && o.timePressure), "the pressured key moment");
    for (const m of timed.mistakes) {
      assert.notEqual(m.primaryTheme, TIME_PRESSURE_THEME);
      const before = plain.mistakes.find((x) => x.epdHash === m.epdHash)!;
      assert.equal(m.primaryTheme, before.primaryTheme, "the primary theme is unchanged");
      assert.deepEqual(m.themes.filter((t) => t !== TIME_PRESSURE_THEME), before.themes, "only the tag is added");
    }
    for (const m of plain.mistakes) assert.ok(!m.themes.includes(TIME_PRESSURE_THEME), "no clocks: no tag");
  });

  it("no tag without a known clock: an untimed game, a DAILY game", async () => {
    for (const over of [
      { moveClocksMs: [] as number[], initialTimeSeconds: 300 },
      { moveClocksMs, initialTimeSeconds: 300, timeClass: "DAILY" },
    ]) {
      const plan = await buildBankPlan(input(over), deps, meta);
      for (const m of plan.mistakes) assert.ok(!m.themes.includes(TIME_PRESSURE_THEME), JSON.stringify(Object.keys(over)));
      for (const o of plan.occurrences) assert.equal(o.timePressure, false);
    }
  });
});
