// The UCI driver and the engine pool (phase-03 plan §12.1 `uci.test`, task C3): info-line parsing (MultiPV, cp, mate,
// bounds ignored, `bestmove (none)`), a 10 s-style timeout → EngineTimeout, a crash → restart + retry once, a second
// failure → EngineFailed, the `engine_crash` fault, nice 19 on the process, and the FakeEngine (ENGINE=fake).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { Chess } from "chess.js";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { FakeEngine } from "./fake";
import { EnginePool } from "./pool";
import { EngineCrashed, EngineFailed, EngineTimeout } from "./types";
import { collectLines, NICE_LEVEL, parseBestmove, parseInfoLine, UciEngine } from "./uci";

const FAKE = fileURLToPath(new URL("./testing/fake-uci.mjs", import.meta.url));
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const metrics = () => new Metrics({ workerId: "t", bootId: "00000000", version: "0", profile: "sf18-v1" }, 0);

function uci(flags: string[] = [], goTimeoutMs = 2_000): UciEngine {
  return new UciEngine({ path: process.execPath, args: [FAKE, ...flags], threads: 1, hashMb: 64, buildId: "fake-uci", goTimeoutMs });
}

const engines: UciEngine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.kill();
    await e.quit().catch(() => undefined);
  }
});

describe("parseInfoLine", () => {
  it("reads a MultiPV 2 centipawn line", () => {
    const info = parseInfoLine("info depth 18 seldepth 25 multipv 2 score cp -35 nodes 119876 nps 650000 hashfull 12 tbhits 0 time 184 pv e7e5 g1f3 b8c6");
    assert.deepEqual(info, {
      multipv: 2,
      depth: 18,
      seldepth: 25,
      score: { cp: -35 },
      nodes: 119876,
      nps: 650000,
      pv: ["e7e5", "g1f3", "b8c6"],
    });
  });

  it("reads a mate score (negative: the side to move gets mated)", () => {
    assert.deepEqual(parseInfoLine("info depth 30 multipv 1 score mate -3 nodes 5 pv h7h8q")?.score, { mate: -3 });
  });

  it("defaults to multipv 1 and skips a wdl triple", () => {
    const info = parseInfoLine("info depth 12 score cp 20 wdl 300 500 200 nodes 10 pv e2e4");
    assert.equal(info?.multipv, 1);
    assert.deepEqual(info?.pv, ["e2e4"]);
  });

  it("ignores lowerbound / upperbound lines, currmove lines, info string and lines without a pv", () => {
    assert.equal(parseInfoLine("info depth 9 multipv 1 score cp 80 lowerbound nodes 900 pv d2d4"), null);
    assert.equal(parseInfoLine("info depth 9 multipv 1 score cp 80 upperbound nodes 900 pv d2d4"), null);
    assert.equal(parseInfoLine("info depth 1 currmove e2e4 currmovenumber 1"), null);
    assert.equal(parseInfoLine("info string NNUE evaluation using nn-c288c895ea92.nnue"), null);
    assert.equal(parseInfoLine("info depth 3 score cp 10 nodes 4"), null);
    assert.equal(parseInfoLine("bestmove e2e4"), null);
  });

  it("refuses a malformed pv", () => {
    assert.equal(parseInfoLine("info depth 3 score cp 10 pv e2e4 ; rm"), null);
  });

  it("parses bestmove, including (none)", () => {
    assert.equal(parseBestmove("bestmove e7e8q ponder a1a2"), "e7e8q");
    assert.equal(parseBestmove("bestmove (none)"), null);
    assert.equal(parseBestmove("info depth 1"), undefined);
  });

  it("collectLines keeps the last exact line per index, sorted", () => {
    const { lines, nps } = collectLines([
      "info depth 5 multipv 2 score cp 1 nodes 1 nps 10 pv a2a3",
      "info depth 5 multipv 1 score cp 2 nodes 1 nps 11 pv e2e4",
      "info depth 6 multipv 1 score cp 3 lowerbound nodes 2 pv d2d4",
      "info depth 6 multipv 1 score cp 4 nodes 2 nps 12 pv d2d4",
    ]);
    assert.deepEqual(
      lines.map((l) => [l.multipv, l.depth, l.score, l.pv[0]]),
      [
        [1, 6, { cp: 4 }, "d2d4"],
        [2, 5, { cp: 1 }, "a2a3"],
      ],
    );
    assert.equal(nps, 12);
  });
});

describe("UciEngine (scripted process)", () => {
  it("handshakes, reads id name, searches with MultiPV 2 and reports the final lines", async () => {
    const e = uci();
    engines.push(e);
    await e.start();
    assert.equal(e.name, "FakeUCI 1");
    await e.newGame();
    const r = await e.search({ fen: START, moves: ["e2e4"], nodes: 120_000, multipv: 2 });
    assert.equal(r.bestmove, "e2e4");
    assert.equal(r.depth, 10);
    assert.deepEqual(r.lines.map((l) => l.score), [{ cp: 35 }, { mate: -3 }]);
    assert.deepEqual(r.lines[0]!.pv, ["e2e4", "e7e5", "g1f3"]);
    assert.equal(r.nps, 100000);
  });

  it("switches MultiPV per search (3 lines for pass 2)", async () => {
    const e = uci();
    engines.push(e);
    await e.start();
    const r = await e.search({ fen: START, nodes: 1_000_000, multipv: 3 });
    assert.equal(r.lines.length, 3);
    assert.deepEqual(r.lines[2]!.score, { cp: -120 });
  });

  it("answers bestmove (none) with a null move and no lines", async () => {
    const e = uci();
    engines.push(e);
    await e.start();
    const r = await e.search({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", nodes: 1000, multipv: 2 });
    assert.equal(r.bestmove, null);
    assert.deepEqual(r.lines, []);
  });

  it("times out without a bestmove (EngineTimeout) and kills the process", async () => {
    const e = uci(["--hang"], 300);
    engines.push(e);
    await e.start();
    await assert.rejects(e.search({ fen: START, nodes: 1000, multipv: 1 }), EngineTimeout);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(e.alive, false);
  });

  it("reports a crash mid-search as EngineCrashed", async () => {
    const e = uci(["--crash-always"]);
    engines.push(e);
    await e.start();
    await assert.rejects(e.search({ fen: START, nodes: 1000, multipv: 1 }), EngineCrashed);
  });

  it("refuses a FEN that would inject a command", async () => {
    const e = uci();
    engines.push(e);
    await e.start();
    await assert.rejects(e.search({ fen: `${START}\nquit`, nodes: 1, multipv: 1 }), RangeError);
  });

  it("runs the engine at nice 19", async () => {
    const e = uci();
    engines.push(e);
    await e.start();
    assert.equal(getPriority(e.pid!), NICE_LEVEL);
  });
});

describe("EnginePool", () => {
  const pool = (flags: string[], goTimeoutMs = 2_000) => {
    const m = metrics();
    const p = new EnginePool({
      factory: () => {
        const e = uci(flags, goTimeoutMs);
        engines.push(e);
        return e;
      },
      log: silentLogger,
      metrics: m,
    });
    return { p, m };
  };

  it("restarts after a crash and retries the same position once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wk-uci-"));
    const flag = join(dir, "crash-once");
    writeFileSync(flag, "1");
    const { p, m } = pool(["--crash-once", flag]);
    await p.start();
    assert.equal(p.state, "ready");
    const r = await p.search({ fen: START, nodes: 1000, multipv: 2 });
    assert.equal(r.bestmove, "e2e4");
    assert.equal(existsSync(flag), false);
    assert.equal(m.engineRestarts, 1);
    assert.equal(m.engineNps, 100000);
  });

  it("restarts after a timeout and retries", async () => {
    const { p, m } = pool(["--hang"], 200);
    await p.start();
    await assert.rejects(p.search({ fen: START, nodes: 1000, multipv: 1 }), EngineFailed);
    assert.ok(m.engineRestarts >= 2, "restarted for the retry and again after the second failure");
  });

  it("fails the position after the second failure (EngineFailed → engine_failed)", async () => {
    const { p } = pool(["--crash-always"]);
    await p.start();
    const err = await p.search({ fen: START, nodes: 1000, multipv: 1 }).catch((e: unknown) => e);
    assert.ok(err instanceof EngineFailed);
    assert.equal(err.code, "engine_failed");
  });

  it("engine_crash fault: 1 crash is absorbed by the retry, 2 fail the search", async () => {
    const { p, m } = pool([]);
    await p.start();
    p.injectCrash(1);
    assert.equal((await p.search({ fen: START, nodes: 1000, multipv: 1 })).bestmove, "e2e4");
    assert.equal(m.engineRestarts, 1);
    p.injectCrash(2);
    await assert.rejects(p.search({ fen: START, nodes: 1000, multipv: 1 }), EngineFailed);
    // A fresh process is left for the next job.
    assert.equal((await p.search({ fen: START, nodes: 1000, multipv: 1 })).bestmove, "e2e4");
  });

  it("reports failed when the engine cannot start", async () => {
    const m = metrics();
    const p = new EnginePool({
      factory: () => new UciEngine({ path: "/nonexistent/stockfish", threads: 1, hashMb: 64, buildId: "x" }),
      log: silentLogger,
      metrics: m,
    });
    await assert.rejects(p.start());
    assert.equal(p.state, "failed");
  });
});

describe("FakeEngine (ENGINE=fake)", () => {
  it("is deterministic, legal, MultiPV-shaped, and finds mate in one", async () => {
    const e = new FakeEngine();
    await e.start();
    const a = await e.search({ fen: START, moves: ["e2e4", "e7e5"], nodes: 120_000, multipv: 2 });
    const b = await e.search({ fen: START, moves: ["e2e4", "e7e5"], nodes: 120_000, multipv: 2 });
    assert.deepEqual(a, b);
    assert.equal(a.lines.length, 2);
    const chess = new Chess(START);
    chess.move("e4");
    chess.move("e5");
    assert.ok(chess.moves({ verbose: true }).some((m) => `${m.from}${m.to}` === a.bestmove));
    // Scholar's mate pattern: Qxf7#.
    const mate = await e.search({
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      nodes: 1,
      multipv: 1,
    });
    assert.equal(mate.bestmove, "h5f7");
    assert.deepEqual(mate.lines[0]!.score, { mate: 1 });
    const none = await e.search({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", nodes: 1, multipv: 2 });
    assert.equal(none.bestmove, null);
    e.kill();
    await assert.rejects(e.search({ fen: START, nodes: 1, multipv: 1 }), EngineCrashed);
  });
});

describe("Stockfish 18 (ENGINE_PATH)", { skip: process.env.ENGINE_PATH ? false : "ENGINE_PATH not set (the worker image and the nightly arm64 job set it)" }, () => {
  it("searches at the sf18-v1 pass-1 budget: MultiPV 2, a legal best move, and a mate score in a mating position", async () => {
    const e = new UciEngine({ path: process.env.ENGINE_PATH!, threads: 1, hashMb: 64, buildId: "sf18-test" });
    engines.push(e);
    await e.start();
    assert.match(e.name, /^Stockfish 18/);
    await e.newGame();
    const r = await e.search({ fen: START, moves: ["e2e4", "e7e5"], nodes: 120_000, multipv: 2 });
    assert.equal(r.lines.length, 2);
    assert.ok(r.depth >= 10, `depth ${r.depth}`);
    assert.ok(r.nodes >= 120_000 && r.nodes < 200_000, `nodes ${r.nodes}`);
    const chess = new Chess(START);
    chess.move("e4");
    chess.move("e5");
    assert.ok(chess.moves({ verbose: true }).some((m) => `${m.from}${m.to}${m.promotion ?? ""}` === r.bestmove));
    const mate = await e.search({ fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", nodes: 120_000, multipv: 2 });
    assert.equal(mate.bestmove, "h5f7");
    assert.deepEqual(mate.lines[0]!.score, { mate: 1 });
    const none = await e.search({ fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", nodes: 1_000, multipv: 2 });
    assert.equal(none.bestmove, null);
  });
});
