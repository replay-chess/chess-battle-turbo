// ERROR_LOG_V1 against the shared grade corpus (phase-06 plan §12.1, §12.5; TE X13): every line of
// `FX/grades/positions.jsonl` labelled MISTAKE, BLUNDER or MISS becomes one error entry whose judgement is the line's
// label and whose Win% loss is the line's (rounded, clamped to 0…100, recomputed from its stored evals with the
// classifier's own `plyLoss`), and the engine attributes it correctly: a blunder counts in its clock bucket, a blunder
// under a minute is a time-pressure event, every error under a minute adds its loss to the time-pressure loss.
// Lines with any other label (INACCURACY included) produce no entry.
//
// The corpus carries no phase or clock tags (its README: single positions with move grades), so the phase comes
// from the position itself (the Divider on the FEN, as the tagger's `phaseOf` does) and every clock bucket 0–4 is
// exercised for each line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { plyLoss } from "@repo/chess-analysis/classify";
import { errorJudgementOf, judgementFromKey, JUDGEMENT_KEYS, type JudgementKey, type ErrorLogClock } from "@repo/chess-analysis/codec";
import { phaseOf } from "@repo/chess-analysis/themes/index";
import { gameInput } from "../../test/gen";
import { aggregate } from "./aggregate";
import { analysedOf } from "./compute";
import { decodeGame } from "./records";

interface Line {
  id: string;
  fen: string;
  evalBefore: number;
  evalAfter: number;
  expected: { label: string; winPctLossApprox: number };
}

const here = dirname(fileURLToPath(import.meta.url));
const LINES: Line[] = readFileSync(resolve(here, "../../../chess-fixtures/grades/positions.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as Line);

const PHASE_INDEX = { opening: 0, middlegame: 1, endgame: 2 } as const;

describe("ERROR_LOG_V1 on the grade corpus", () => {
  it("reads the corpus (≥ 80 lines, with mistakes, blunders and misses)", () => {
    assert.ok(LINES.length >= 80);
    for (const label of ["mistake", "blunder", "miss", "inaccuracy"]) assert.ok(LINES.some((l) => l.expected.label === label), label);
  });

  it("errors map to their judgement and Win% loss; every other label (INACCURACY included) gives no entry", () => {
    let errors = 0;
    for (const line of LINES) {
      const key = line.expected.label as JudgementKey;
      assert.ok(JUDGEMENT_KEYS.includes(key), line.id);
      const j = errorJudgementOf(judgementFromKey(key));
      if (key === "mistake") assert.equal(j, 0, line.id);
      else if (key === "blunder") assert.equal(j, 1, line.id);
      else if (key === "miss") assert.equal(j, 2, line.id);
      else {
        assert.equal(j, null, `${line.id} (${key}) must not be logged`);
        continue;
      }
      errors += 1;
      const mover = line.fen.split(" ")[1] as "w" | "b";
      const loss = plyLoss(line.evalBefore, line.evalAfter, mover);
      assert.ok(Math.abs(loss - line.expected.winPctLossApprox) < 0.01, `${line.id}: ${loss} vs ${line.expected.winPctLossApprox}`);
    }
    assert.ok(errors >= 25, `${errors} error lines`);
  });

  it("the engine attributes each corpus error's judgement, phase, clock bucket and loss exactly", () => {
    for (const line of LINES) {
      const j = errorJudgementOf(judgementFromKey(line.expected.label as JudgementKey));
      if (j === null) continue;
      const winLoss = Math.max(0, Math.min(100, Math.round(line.expected.winPctLossApprox)));
      const phase = PHASE_INDEX[phaseOf(line.fen)];
      for (const clockBucket of [0, 1, 2, 3, 4] as ErrorLogClock[]) {
        const g = gameInput({
          gameId: "1",
          color: "w",
          endedAt: new Date("2026-11-10T12:00:00Z"),
          phaseMoves: [10, 20, 10],
          clockMoves: [10, 10, 10, 10],
          errors: [{ judgement: j, phase, clockBucket, winLoss, themes: ["fork"] }],
        });
        const d = decodeGame(g)!;
        assert.deepEqual(
          { judgement: d.errors[0]!.judgement, phase: d.errors[0]!.phase, clockBucket: d.errors[0]!.clockBucket, winLoss: d.errors[0]!.winLoss },
          { judgement: j, phase, clockBucket, winLoss },
          line.id,
        );
        const a = aggregate(analysedOf([g]));
        const blunderBucket: number = j === 1 && clockBucket > 0 ? clockBucket - 1 : -1;
        assert.deepEqual(a.clockBlunders, [0, 1, 2, 3].map((b) => (b === blunderBucket ? 1 : 0)), `${line.id} bucket ${clockBucket}`);
        assert.equal(a.tp.k, j === 1 && clockBucket === 4 ? 1 : 0, `${line.id} bucket ${clockBucket}`);
        assert.equal(a.tp.L, clockBucket === 4 ? winLoss : 0, `${line.id} bucket ${clockBucket}`);
        assert.equal(a.themes.get("fork")!.phaseCount[phase], 1, line.id);
        assert.equal(a.themes.get("fork")!.L, winLoss, line.id);
      }
    }
  });
});
