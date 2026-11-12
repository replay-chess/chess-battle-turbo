// The position corpus (phase-03 plan §8.4 "Position corpus", §12.4, TST X13): every line of
// `packages/chess-fixtures/grades/positions.jsonl` gives its expected label from stored evals only (pure).
//
// Line shape: {id, fen, move (SAN), evalBefore, evalAfter (stored, White POV), best (SAN or null), second?,
// legalCount, expected: {label, winPctLossApprox}, source, context?, note?}. `context` carries what one position
// cannot: the opponent's previous ply (`oppPrev`: its stored evals before and after, for MISS), the opponent's reply
// (`reply`, SAN after the move, for the sacrifice check) and the rule-2 premises (`ply`, `initialStart`,
// `bookChain`, `inBook`; with `seedBook` the membership is checked against the real seed book set).
//
// `source` says where the evals come from: `constructed` (set on a rule boundary), `design-mock`, `mate-fact`
// (forced mates, exact), `approx` (hand estimates of real positions), `sf18-v1` (re-sourced by eval-provenance
// --write) and `lichess:<game>#<ply>` (Lichess's published
// engine evals, labelled with Lichess's own judgement). The nightly eval-provenance job checks every line that is not
// constructed or design-mock against Stockfish 18 sf18-v1 (scripts/eval-provenance.ts). P5, P6 and P7 derive their
// expectations from the same lines.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { epdOf } from "./board";
import { buildBookSet, parseOpeningsTsv } from "./book";
import { classifyPly, plyLoss } from "./classify";
import { judgementKey, NO_SECOND, type Color } from "./codec";
import { ENGINE_PROFILE } from "./version";

export interface PositionLine {
  id: string;
  fen: string;
  move: string;
  evalBefore: number;
  evalAfter: number;
  best: string | null;
  second?: number;
  legalCount: number;
  expected: { label: string; winPctLossApprox: number };
  source: string;
  note?: string;
  context?: {
    oppPrev?: { evalBefore: number; evalAfter: number };
    reply?: string;
    ply?: number;
    initialStart?: boolean;
    bookChain?: boolean;
    inBook?: boolean;
    /** The inBook premise is checked against the seed book set. */
    seedBook?: boolean;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const POSITIONS_FILE = path.resolve(here, "../../chess-fixtures/grades/positions.jsonl");
const LINES: PositionLine[] = readFileSync(POSITIONS_FILE, "utf8")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => JSON.parse(l) as PositionLine);

const OPENINGS = path.resolve(here, "../../../apps/web/public/openings");
const seedBook = buildBookSet(
  ["a", "b", "c", "d", "e"]
    .flatMap((f) => parseOpeningsTsv(readFileSync(path.join(OPENINGS, `${f}.tsv`), "utf8")))
    .map((l) => l.pgn),
).book;

function uci(fen: string, san: string): string {
  const m = new Chess(fen).move(san);
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

describe("positions.jsonl", () => {
  it("has at least 80 lines with unique ids, covering the §8.4 list", () => {
    assert.ok(LINES.length >= 80, `${LINES.length} lines`);
    assert.equal(new Set(LINES.map((l) => l.id)).size, LINES.length);
    const ids = LINES.map((l) => l.id).join(" ");
    for (const must of [
      "severity-w-4.998",
      "severity-w-5.000",
      "severity-w-9.9999",
      "severity-w-10.0000",
      "severity-w-14.9991",
      "severity-w-15.0000",
      "mate-created",
      "mate-lost",
      "mate-delayed",
      "miss-game-ply36",
      "great-hold-vs-lose",
      "brilliant-opera-qb8",
      "not-brilliant-above-300",
      "forced",
      "book-ply-29",
      "book-cap-ply-30",
      "book-fen-start",
      "fools-mate-g4",
      "scholars-mate-nf6",
      "scholars-mate-qxf7",
      "legals-trap-bxd1",
      "brilliant-kt-rxd4",
      "brilliant-byrne-fischer-be6",
      "lichess-",
    ]) {
      assert.ok(ids.includes(must), `missing ${must}`);
    }
    const labels = new Set(LINES.map((l) => l.expected.label));
    for (const label of [
      "brilliant",
      "great",
      "best",
      "excellent",
      "good",
      "book",
      "forced",
      "inaccuracy",
      "mistake",
      "miss",
      "blunder",
    ]) {
      assert.ok(labels.has(label), `no line expects ${label}`);
    }
    assert.ok(!labels.has("interesting"), "INTERESTING is never emitted in GRADING_VERSION 1");
  });

  for (const line of LINES) {
    it(`${line.id} → ${line.expected.label}`, () => {
      const chess = new Chess(line.fen);
      const mover = chess.turn() as Color;
      assert.equal(chess.moves().length, line.legalCount, "legalCount matches the position");
      const played = uci(line.fen, line.move);
      const best = line.best === null ? null : uci(line.fen, line.best);
      const after = new Chess(line.fen);
      after.move(line.move);
      const reply = line.context?.reply ? uci(after.fen(), line.context.reply) : null;

      const ctx = line.context ?? {};
      if (ctx.seedBook && ctx.inBook) assert.ok(seedBook.has(epdOf(after.fen())), "premise: the seed book holds it");
      const book =
        ctx.initialStart === true &&
        ctx.bookChain === true &&
        ctx.inBook === true &&
        (ctx.ply ?? Number.POSITIVE_INFINITY) < ENGINE_PROFILE.bookMaxPly;

      const opp: Color = mover === "w" ? "b" : "w";
      const oppPrev = ctx.oppPrev
        ? { loss: plyLoss(ctx.oppPrev.evalBefore, ctx.oppPrev.evalAfter, opp), evalBefore: ctx.oppPrev.evalBefore }
        : null;

      const grade = classifyPly({
        ply: ctx.ply ?? 40,
        mover,
        fenBefore: line.fen,
        played,
        legalCount: line.legalCount,
        evalBefore: line.evalBefore,
        evalAfter: line.evalAfter,
        second: line.second ?? NO_SECOND,
        best,
        reply,
        book,
        oppPrev,
      });
      assert.equal(judgementKey(grade.code), line.expected.label);
      assert.ok(
        Math.abs(grade.loss - line.expected.winPctLossApprox) <= 0.0001,
        `loss ${grade.loss} vs ${line.expected.winPctLossApprox}`,
      );
    });
  }
});
