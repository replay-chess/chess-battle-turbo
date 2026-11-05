import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import {
  FIXTURE_LEGENDS,
  FIXTURE_POSITIONS,
  OPERA_GAME_PGN,
  famousGamesFor,
  moveNumberFromFen,
  sideToMoveFromFen,
} from "./design-legend-positions";

test("there are 6 legends and 5 positions with unique keys", () => {
  assert.equal(FIXTURE_LEGENDS.length, 6);
  assert.equal(FIXTURE_POSITIONS.length, 5);
  assert.equal(new Set(FIXTURE_LEGENDS.map((l) => l.name)).size, 6);
  assert.equal(new Set(FIXTURE_POSITIONS.map((p) => p.fen)).size, 5);
  assert.deepEqual(
    FIXTURE_POSITIONS.map((p) => p.key),
    ["mo", "kt", "bf", "ak", "ts"],
  );
});

test("every FEN loads in chess.js and round-trips", () => {
  for (const p of FIXTURE_POSITIONS) {
    const c = new Chess(p.fen);
    assert.equal(c.fen(), p.fen, p.key);
    assert.ok(c.moves().length > 0, `${p.key} has legal moves`);
  }
});

test("the side to move matches the FEN, and moveNumber is the full-move field", () => {
  const expectedMove = { mo: 10, kt: 24, bf: 17, ak: 18, ts: 47 };
  for (const p of FIXTURE_POSITIONS) {
    assert.equal(sideToMoveFromFen(p.fen), p.sideToMove, p.key);
    assert.equal(new Chess(p.fen).turn() === "w" ? "white" : "black", p.sideToMove, p.key);
    assert.equal(moveNumberFromFen(p.fen), expectedMove[p.key], p.key);
  }
  assert.throws(() => sideToMoveFromFen("8/8/8/8/8/8/8/8 x - - 0 1"));
  assert.throws(() => moveNumberFromFen("8/8/8/8/8/8/8/8 w - - 0 x"));
});

test("the mo PGN reaches exactly the mo FEN; only mo has a PGN", () => {
  const mo = FIXTURE_POSITIONS.find((p) => p.key === "mo");
  assert.ok(mo);
  assert.equal(mo.pgn, OPERA_GAME_PGN);
  const c = new Chess();
  c.loadPgn(OPERA_GAME_PGN);
  assert.equal(c.fen(), mo.fen);
  for (const p of FIXTURE_POSITIONS.filter((x) => x.key !== "mo")) assert.equal(p.pgn, null, p.key);
});

test("every legend referenced by a position exists in the legend list", () => {
  const names = new Set(FIXTURE_LEGENDS.map((l) => l.name));
  for (const p of FIXTURE_POSITIONS) {
    if (p.whiteIsLegend) assert.ok(names.has(p.white), `${p.key} white ${p.white}`);
    else assert.ok(!names.has(p.white), `${p.key} white ${p.white} should be name-only`);
    if (p.blackIsLegend) assert.ok(names.has(p.black), `${p.key} black ${p.black}`);
    else assert.ok(!names.has(p.black), `${p.key} black ${p.black} should be name-only`);
  }
  // Every legend appears in at least one position, so famousGames is never empty.
  for (const l of FIXTURE_LEGENDS) assert.ok(famousGamesFor(l.name).length > 0, l.name);
  assert.equal(famousGamesFor("Veselin Topalov").length, 2);
  assert.deepEqual(Object.keys(famousGamesFor("Paul Morphy")[0]!).sort(), ["fen", "title", "year"]);
});

test("shortDescription fits VarChar(500) and the table's columns are filled", () => {
  for (const l of FIXTURE_LEGENDS) {
    assert.ok(l.shortDescription.length > 0 && l.shortDescription.length <= 500, l.name);
    assert.ok(l.era === "Romantic Era" || l.era === "Modern Era", l.name);
    assert.match(l.nationality, /^[A-Z]{3}$/, l.name);
    assert.ok(Array.isArray(l.achievements) && l.achievements.length > 0, l.name);
    if (l.deathYear !== null) assert.ok(l.deathYear > l.birthYear, l.name);
  }
});
