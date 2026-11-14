// "Becomes a bank item" over P3's shared grade corpus (phase-05 plan §12.1, testing X13): for every line of
// `@repo/chess-fixtures/grades/positions.jsonl` the expectation is derived from the line's EXPECTED grade (not from
// our classifier): MISTAKE, BLUNDER and MISS always; an INACCURACY when it lost ≥ 7 Win% from an undecided position
// (10–90); BOOK and the first 6 plies never. `selectCandidates()` on that one ply must agree, so the bank rule and
// the grade labels P3, P6 and P7 share cannot drift apart.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { evalFor, judgementFromKey, type Color, type JudgementKey } from "../codec";
import { winPct } from "../winpct";
import { BANK_INACCURACY_MIN_LOSS, BANK_SKIP_FIRST_PLIES, BANK_UNDECIDED, selectCandidates } from "./candidates";

interface CorpusLine {
  id: string;
  fen: string;
  evalBefore: number;
  evalAfter: number;
  expected: { label: JudgementKey; winPctLossApprox: number };
  context?: { ply?: number };
}

const require = createRequire(import.meta.url);
const path = require.resolve("@repo/chess-fixtures/grades/positions.jsonl");
const lines = readFileSync(path, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as CorpusLine);

/** Absolute ply of the position: the line's own `context.ply` when given, else from the FEN's move number. */
function absolutePly(line: CorpusLine): number {
  if (typeof line.context?.ply === "number") return line.context.ply;
  const [, side, , , , full] = line.fen.split(" ");
  return 2 * (Number(full) - 1) + (side === "b" ? 1 : 0);
}

/** The rule of plan §8.1 step 1 applied to the expected label (independent of selectCandidates). */
function expectedBankItem(line: CorpusLine, mover: Color): boolean {
  const label = line.expected.label;
  if (label === "book" || absolutePly(line) < BANK_SKIP_FIRST_PLIES) return false;
  if (label === "mistake" || label === "blunder" || label === "miss") return true;
  if (label !== "inaccuracy") return false;
  const winBefore = winPct(evalFor(line.evalBefore, mover));
  return (
    line.expected.winPctLossApprox >= BANK_INACCURACY_MIN_LOSS &&
    winBefore >= BANK_UNDECIDED.LOW &&
    winBefore <= BANK_UNDECIDED.HIGH
  );
}

describe("bank items over the shared grade corpus", () => {
  it("reads the whole corpus", () => {
    assert.ok(lines.length >= 90, `${lines.length} lines`);
  });

  let items = 0;
  for (const line of lines) {
    it(`${line.id}: ${line.expected.label}`, () => {
      const mover = line.fen.split(" ")[1] as Color;
      const out = selectCandidates({
        judgements: [judgementFromKey(line.expected.label)],
        evals: [line.evalBefore, line.evalAfter],
        side: mover,
        startMover: mover,
        startPly: absolutePly(line),
        momentPlies: [],
      });
      const expected = expectedBankItem(line, mover);
      if (expected) items++;
      assert.equal(out.length === 1, expected, `${line.id} becomes a bank item: ${expected}`);
      if (expected) assert.equal(out[0]!.source, line.expected.label === "miss" ? "MISSED_PUNISH" : "OWN_ERROR");
    });
  }

  it("covers both outcomes", () => {
    assert.ok(items >= 10 && items < lines.length, `${items} bank items of ${lines.length}`);
  });
});
