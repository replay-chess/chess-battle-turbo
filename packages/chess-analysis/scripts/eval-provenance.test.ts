// The eval-provenance script's pure parts and its UCI client (against a scripted fake engine, so no Stockfish is
// needed here; the real run is the nightly arm64 job).
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { encodeMate } from "../src/codec";
import {
  EXEMPT_SOURCES,
  goldenChecks,
  labelChecks,
  parseInfo,
  positionChecks,
  POSITIONS_FILE,
  rewritePositions,
  runChecks,
  terminalEval,
  UciEngine,
  withinTolerance,
} from "./eval-provenance";

/** A fake UCI engine: answers uci/isready, and for `go` prints MultiPV 1 and 2 lines with a fixed score. */
const FAKE_ENGINE = `
let fen = "";
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const cmd = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (cmd === "uci") console.log("id name Fake\\nuciok");
    else if (cmd === "isready") console.log("readyok");
    else if (cmd.startsWith("position fen ")) fen = cmd.slice(13);
    else if (cmd.startsWith("go")) {
      const mate = fen.startsWith("6k1/5ppp");
      console.log("info depth 5 multipv 1 score cp 10 lowerbound nodes 1000 pv e2e4");
      console.log(mate ? "info depth 9 multipv 1 score mate 1 nodes 120000 pv a1a8" : "info depth 9 multipv 1 score cp 25 nodes 120000 pv e2e4");
      console.log("info depth 9 multipv 2 score cp -40 nodes 120000 pv d2d4");
      console.log("bestmove e2e4");
    } else if (cmd === "quit") process.exit(0);
  }
});
`;

describe("eval-provenance helpers", () => {
  it("parses final scores and ignores bounds", () => {
    assert.deepEqual(parseInfo("info depth 18 seldepth 25 multipv 2 score cp -35 nodes 120000 pv e7e5"), {
      multipv: 2,
      score: { cp: -35 },
    });
    assert.deepEqual(parseInfo("info depth 20 score mate -3 nodes 9 pv a1a2"), { multipv: 1, score: { mate: -3 } });
    assert.equal(parseInfo("info depth 18 multipv 1 score cp 12 lowerbound nodes 5"), null);
    assert.equal(parseInfo("info string NNUE evaluation enabled"), null);
    assert.equal(parseInfo("bestmove e2e4"), null);
  });

  it("tolerance: ±30 cp, or the same mate", () => {
    assert.ok(withinTolerance(20, 50));
    assert.ok(!withinTolerance(20, 51));
    assert.ok(withinTolerance(encodeMate("w", 3), encodeMate("w", 3)));
    assert.ok(!withinTolerance(encodeMate("w", 3), encodeMate("w", 4)));
    assert.ok(!withinTolerance(encodeMate("w", 3), encodeMate("b", 3)));
    assert.ok(!withinTolerance(900, encodeMate("w", 9)));
  });

  it("terminal positions need no search", () => {
    assert.equal(terminalEval("R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 1 1"), encodeMate("w", 0));
    assert.equal(terminalEval("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), 0);
    assert.equal(terminalEval("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), null);
  });

  it("checks every non-exempt corpus line before and after its move", () => {
    const rows = readFileSync(POSITIONS_FILE, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: string; source: string });
    const checked = rows.filter((r) => !EXEMPT_SOURCES.has(r.source));
    const checks = positionChecks();
    assert.equal(checks.length, checked.length * 2);
    assert.ok(checks.some((c) => c.where === "positions.jsonl:fools-mate-g4:before"));
    assert.ok(!checks.some((c) => c.where.includes(":severity-")), "constructed lines are skipped");
  });

  it("skips constructed label files and reads goldens", () => {
    assert.deepEqual(labelChecks(), [], "every edge file is constructed");
    const dir = mkdtempSync(path.join(tmpdir(), "golden-"));
    try {
      writeFileSync(
        path.join(dir, "g1.json"),
        JSON.stringify({
          startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          moves: "e2e4 e7e5",
          evals: [15, 30, 25],
        }),
      );
      writeFileSync(
        path.join(dir, "g2.json"),
        JSON.stringify({
          startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          analysis: { moves: ["d2d4"], evals: [15, 20] },
        }),
      );
      const g = goldenChecks(dir);
      assert.equal(g.length, 5);
      assert.equal(g[2]?.stored, 25);
      assert.equal(goldenChecks(path.join(dir, "missing")).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the UCI client and the run", () => {
  it("runs the sf18-v1 search through a UCI engine and reports drift", async () => {
    const engine = await UciEngine.start(process.execPath, ["-e", FAKE_ENGINE]);
    try {
      // White to move: +25 stays +25. Black to move: the engine's +25 (for Black) is −25 White POV.
      assert.equal(await engine.evaluate("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 25);
      assert.equal(await engine.evaluate("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), -25);
      assert.equal(await engine.evaluate("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"), encodeMate("w", 1));
      const { drift } = await runChecks(engine, [
        { where: "a", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", stored: 40 },
        { where: "b", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", stored: 60 },
        { where: "c", fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", stored: encodeMate("w", 2) },
      ]);
      assert.deepEqual(
        drift.map((d) => [d.where, d.engine]),
        [
          ["b", 25],
          ["c", encodeMate("w", 1)],
        ],
      );
    } finally {
      await engine.stop();
    }
  });

  it("--write rewrites drifted corpus lines and keeps their labels", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "positions-"));
    const file = path.join(dir, "positions.jsonl");
    try {
      const row = {
        id: "x",
        fen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
        move: "g4",
        evalBefore: -60,
        evalAfter: encodeMate("b", 1),
        expected: { label: "blunder", winPctLossApprox: 40 },
        source: "approx",
      };
      writeFileSync(file, `${JSON.stringify(row)}\n`);
      const ids = rewritePositions(
        [{ where: "positions.jsonl:x:before", fen: row.fen, stored: -60, engine: -95 }],
        file,
      );
      assert.deepEqual(ids, ["x"]);
      const back = JSON.parse(readFileSync(file, "utf8").trim()) as typeof row;
      assert.equal(back.evalBefore, -95);
      assert.equal(back.evalAfter, row.evalAfter);
      assert.equal(back.source, "sf18-v1");
      assert.equal(back.expected.label, "blunder");
      assert.equal(back.expected.winPctLossApprox, 38.8879);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
