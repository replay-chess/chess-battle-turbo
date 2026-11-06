// Shape checks for the data-only fixtures (illegal reasons, PGN rules, perft); the behaviour tests live in
// @repo/game-core. Every PGN loads with chess.js and every FEN is valid.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess, validateFen } from "chess.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("illegal-reasons.json: valid FENs, unique ids, sentence-shaped reasons", () => {
  const j = JSON.parse(readFileSync(path.join(ROOT, "rules/illegal-reasons.json"), "utf8")) as {
    cases: { id: string; fen: string; from: string; to: string; reason: string; text: string }[];
  };
  const ids = new Set<string>();
  for (const c of j.cases) {
    assert.ok(!ids.has(c.id), c.id);
    ids.add(c.id);
    assert.ok(validateFen(c.fen).ok, `${c.id}: ${c.fen}`);
    assert.match(c.from + c.to, /^[a-h][1-8][a-h][1-8]$/);
    assert.match(c.text, /^[a-z].*\.$/, `${c.id}: lower-case start, full stop`);
  }
  assert.ok(j.cases.length >= 20);
});

test("pgn/rules: every file loads with chess.js", () => {
  const dir = path.join(ROOT, "pgn/rules");
  const files = readdirSync(dir).filter((f) => f.endsWith(".pgn"));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const chess = new Chess();
    chess.loadPgn(readFileSync(path.join(dir, f), "utf8"));
    assert.ok(chess.history().length > 0, f);
  }
});

test("perft/positions.json: valid FENs with a required depth on the plan's two gates", () => {
  const j = JSON.parse(readFileSync(path.join(ROOT, "perft/positions.json"), "utf8")) as {
    positions: { name: string; fen: string; depths: Record<string, number>; required?: number }[];
  };
  for (const p of j.positions) assert.ok(validateFen(p.fen).ok, p.name);
  assert.equal(j.positions.find((p) => p.name === "start")?.depths["4"], 197281);
  assert.equal(j.positions.find((p) => p.name === "kiwipete")?.depths["3"], 97862);
});
