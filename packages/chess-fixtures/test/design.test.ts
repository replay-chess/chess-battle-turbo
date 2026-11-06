// Every design-embedded position replays legally (phase-02 plan 12.2, testing X13): a typo in a design line fails
// here instead of becoming a test expectation. Fixtures come from scripts/qa/extract-design-fens.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess, validateFen } from "chess.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "design");

type Line = {
  startFen: string;
  startMoveNo: number;
  gameStartsAtPly: number;
  san: string[];
  uci: string[];
  designFens: string[];
};
type State = {
  line: string;
  ply: number;
  lastMove: [string, string] | null;
  promotion: { square: string; fens: Record<string, string> } | null;
  badges: { square: string; kind: string }[];
};
type Fixture = { board: string; lines: Record<string, Line>; states: Record<string, State> };

const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const placementSide = (fen: string) => fen.split(" ").slice(0, 2).join(" ");

test("index.json maps every board to an existing fixture file", () => {
  const index = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8")) as { boards: Record<string, string> };
  assert.ok(Object.keys(index.boards).length >= 1);
  for (const [board, file] of Object.entries(index.boards)) assert.ok(files.includes(file), `${board} → ${file}`);
  assert.equal(index.boards.V3Game, "V3Game.json");
});

for (const file of files) {
  const fx = JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as Fixture;

  for (const [name, line] of Object.entries(fx.lines)) {
    test(`${fx.board} line ${name} replays legally and matches the design positions`, () => {
      assert.ok(validateFen(line.startFen).ok, `start FEN ${line.startFen}`);
      const chess = new Chess(line.startFen);
      line.san.forEach((san, i) => {
        const mv = chess.move(san); // throws on an illegal design move
        assert.equal(mv.san, san, `${name} ply ${i + 1}: SAN`);
        assert.equal(`${mv.from}${mv.to}${mv.promotion ?? ""}`, line.uci[i], `${name} ply ${i + 1}: UCI`);
        assert.equal(placementSide(chess.fen()), line.designFens[i], `${name} ply ${i + 1}: position`);
      });
      assert.ok(line.gameStartsAtPly <= line.san.length);
    });
  }

  test(`${fx.board} states point at real plies, last moves and legal promotion positions`, () => {
    for (const [state, s] of Object.entries(fx.states)) {
      const line = fx.lines[s.line];
      assert.ok(line, `${state}: line ${s.line}`);
      assert.ok(s.ply >= 0 && s.ply <= line.san.length, `${state}: ply ${s.ply} of ${line.san.length}`);
      if (s.lastMove && s.ply > 0 && !s.promotion) {
        // The board marks the ply's move (castling is drawn king from → to).
        const uci = line.uci[s.ply - 1]!;
        assert.deepEqual(s.lastMove, [uci.slice(0, 2), uci.slice(2, 4)], `${state}: last move`);
      }
      if (s.promotion) {
        for (const [piece, fen] of Object.entries(s.promotion.fens))
          assert.ok(validateFen(fen).ok, `${state} ${piece}: ${fen}`);
      }
      const chess = new Chess(line.startFen);
      for (const san of line.san.slice(0, s.ply)) chess.move(san);
      for (const b of s.badges)
        assert.equal(chess.get(b.square as never)?.type, "k", `${state}: ${b.kind} badge on a king`);
    }
  });
}

test("V3Game L.MAIN is the Opera Game to 17.Rd8#", () => {
  const fx = JSON.parse(readFileSync(path.join(DIR, "V3Game.json"), "utf8")) as Fixture;
  const main = fx.lines.MAIN!;
  assert.equal(main.san.length, 33);
  assert.equal(main.san.at(-1), "Rd8#");
  assert.equal(main.gameStartsAtPly, 18);
  const chess = new Chess(main.startFen);
  for (const san of main.san) chess.move(san);
  assert.ok(chess.isCheckmate());
});
