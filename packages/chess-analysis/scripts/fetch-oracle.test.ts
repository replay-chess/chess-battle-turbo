// scripts/fetch-oracle.ts: normalisation of a Lichess export and the committed fixture format (no network).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ORACLE_IDS, normalizeGame, serializeGame, type OracleGame } from "./fetch-oracle";

const raw = {
  id: "abcd1234",
  variant: "standard",
  speed: "blitz",
  status: "mate",
  winner: "black" as const,
  moves: "f3 e5 g4 Qh4#",
  players: {
    white: {
      user: { name: "someone", id: "someone" },
      rating: 1500,
      analysis: { inaccuracy: 0, mistake: 1, blunder: 1, acpl: 300, accuracy: 20, phases: { opening: 20 } },
    },
    black: {
      user: { name: "other", id: "other" },
      rating: 1510,
      analysis: { inaccuracy: 0, mistake: 0, blunder: 0, acpl: 0, accuracy: 100, phases: { opening: 100 } },
    },
  },
  analysis: [
    { eval: -50, best: "e2e4", variation: "e4 e5", judgment: { name: "Inaccuracy", comment: "…" } },
    { eval: -40 },
    { mate: -1, best: "e2e4", judgment: { name: "Blunder", comment: "…" } },
    { mate: 0 },
  ],
  division: { middle: 3 },
};

describe("fetch-oracle", () => {
  it("lists 30 distinct game ids", () => {
    assert.equal(ORACLE_IDS.length, 30);
    assert.equal(new Set(ORACLE_IDS).size, 30);
  });

  it("drops player names and comments, keeps evals, best moves, judgements, accuracy and division", () => {
    const g = normalizeGame(raw, "2026-11-11");
    assert.equal(g.url, "https://lichess.org/abcd1234");
    assert.deepEqual(g.moves, ["f3", "e5", "g4", "Qh4#"]);
    assert.deepEqual(g.analysis, [
      { eval: -50, best: "e2e4", judgment: "Inaccuracy" },
      { eval: -40 },
      { mate: -1, best: "e2e4", judgment: "Blunder" },
      { mate: 0 },
    ]);
    assert.equal(g.players.white.accuracy, 20);
    assert.equal(g.players.black.rating, 1510);
    assert.deepEqual(g.division, { middle: 3 });
    assert.ok(!JSON.stringify(g).includes("someone"));
  });

  it("refuses unanalysed, non-standard and truncated games", () => {
    assert.throws(() => normalizeGame({ ...raw, variant: "chess960" }, "x"));
    assert.throws(() => normalizeGame({ ...raw, players: { ...raw.players, white: { rating: 1500 } } }, "x"));
    assert.throws(() => normalizeGame({ ...raw, analysis: raw.analysis.slice(0, 2) }, "x"));
  });

  it("serialises to parseable JSON that the committed fixtures use", () => {
    const g = normalizeGame(raw, "2026-11-11");
    const parsed = JSON.parse(serializeGame(g)) as { moves: string; analysis: unknown[] };
    assert.equal(parsed.moves, "f3 e5 g4 Qh4#");
    assert.deepEqual(parsed.analysis, g.analysis);
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/oracle");
    for (const id of ORACLE_IDS) {
      const text = readFileSync(path.join(dir, `${id}.json`), "utf8");
      const fixture = JSON.parse(text) as Omit<OracleGame, "moves"> & { moves: string };
      assert.equal(serializeGame({ ...fixture, moves: fixture.moves.split(" ") }), text, id);
    }
  });
});
