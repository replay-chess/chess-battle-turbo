// The P5 chess-correctness fixtures (phase-05 plan §12.3): every theme fixture under puzzles/ (the Tier-1 tagger's
// oracle, `<theme>.json`) holds 50 Lichess puzzles with the theme and 50 without, and every line replays legally from
// its FEN (the setup move, then the solution); the Mistake Bank design fixtures parse, their FENs are valid, and the
// `playedLegal` flag of each V3MistakeBank row is what chess.js says. (The shard subset under puzzles/shards/ is WP-D's
// and has its own test.)
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess, validateFen } from "chess.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUZZLES = path.join(ROOT, "puzzles");
const DESIGN = path.join(ROOT, "design");

type Row = [string, string, string, number, string];
interface ThemeFixture {
  theme: string;
  licence: string;
  source: string;
  columns: string[];
  with: Row[];
  without: Row[];
}

const themeFiles = readdirSync(PUZZLES).filter((f) => f.endsWith(".json"));

function replays(row: Row): boolean {
  const chess = new Chess(row[1]);
  for (const uci of row[2].split(" ")) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
  }
  return true;
}

test("puzzles/ holds the Tier-1 theme fixtures", () => {
  assert.ok(themeFiles.length >= 30, `${themeFiles.length} theme files`);
});

for (const file of themeFiles) {
  test(`puzzles/${file}: 50 with the theme, 50 without, CC0, every line legal`, () => {
    const fx = JSON.parse(readFileSync(path.join(PUZZLES, file), "utf8")) as ThemeFixture;
    assert.equal(`${fx.theme}.json`, file);
    assert.equal(fx.licence, "CC0");
    assert.match(fx.source, /database\.lichess\.org/);
    assert.deepEqual(fx.columns, ["id", "fen", "moves", "rating", "themes"]);
    assert.equal(fx.with.length, 50);
    assert.equal(fx.without.length, 50);
    const ids = new Set<string>();
    for (const [side, rows] of [
      ["with", fx.with],
      ["without", fx.without],
    ] as const) {
      for (const row of rows) {
        assert.ok(!ids.has(row[0]), `${row[0]} appears once`);
        ids.add(row[0]);
        assert.ok(validateFen(row[1]).ok, `${row[0]}: FEN`);
        assert.ok(row[2].split(" ").length >= 2, `${row[0]}: a setup move and a solution`);
        assert.ok(replays(row), `${row[0]}: the line replays legally`);
        assert.equal(row[4].split(" ").includes(fx.theme), side === "with", `${row[0]}: ${side} ${fx.theme}`);
      }
    }
  });
}

test("design/v3-bank-session.json: three drill positions with their expectations", () => {
  const fx = JSON.parse(readFileSync(path.join(DESIGN, "v3-bank-session.json"), "utf8")) as {
    lines: Record<string, { startFen: string; uci: string[] }>;
    positions: { line: string; playedLine: string; fen: string; best: string; played: string; expected: { solution: string; primaryTheme: string } }[];
  };
  assert.equal(fx.positions.length, 3);
  for (const p of fx.positions) {
    assert.equal(fx.lines[p.line]?.startFen, p.fen);
    assert.equal(fx.lines[p.line]?.uci[0], p.best);
    assert.equal(fx.lines[p.playedLine]?.uci[0], p.played);
    assert.equal(p.expected.solution, p.best);
    assert.notEqual(p.best, p.played);
  }
  assert.deepEqual(
    fx.positions.map((p) => p.expected.primaryTheme),
    ["rc:recapture", "hangingPiece", "rc:defendedTarget"],
  );
});

test("design/v3-mistake-bank.json: 23 rows, valid FENs, contract values, honest playedLegal flags", () => {
  const fx = JSON.parse(readFileSync(path.join(DESIGN, "v3-mistake-bank.json"), "utf8")) as {
    rows: {
      fen: string;
      playedSan: string;
      playedLegal: boolean;
      theme: string;
      judgement: string;
      source: string;
      phase: string;
      mastery: number;
    }[];
  };
  assert.equal(fx.rows.length, 23);
  for (const r of fx.rows) {
    assert.ok(validateFen(r.fen).ok, r.fen);
    let legal = true;
    try {
      new Chess(r.fen).move(r.playedSan);
    } catch {
      legal = false;
    }
    assert.equal(r.playedLegal, legal, `${r.playedSan} in ${r.fen}`);
    assert.ok(["fork", "hangingPiece", "backRankMate", "rc:recapture", "rc:defendedTarget", "rc:pawnStructure"].includes(r.theme));
    assert.ok(["INACCURACY", "MISTAKE", "MISS", "BLUNDER"].includes(r.judgement));
    assert.ok(["OWN_ERROR", "MISSED_PUNISH"].includes(r.source));
    assert.ok(["OPENING", "MIDDLEGAME", "ENDGAME"].includes(r.phase));
    assert.ok(Number.isInteger(r.mastery) && r.mastery >= 0 && r.mastery <= 5);
  }
});
