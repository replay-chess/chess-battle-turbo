// A scripted UCI process for the driver tests (uci.test.ts). It speaks just enough UCI and prints the line shapes the
// parser must handle: a `currmove` line, a `lowerbound` line, MultiPV 1/2 exact lines (cp and mate), `bestmove`.
//
//   --hang               never answers `go` (EngineTimeout)
//   --crash-always       exits on every `go` (EngineCrashed, twice → EngineFailed)
//   --crash-once <file>  exits on `go` while <file> exists, deleting it first (restart + retry succeeds)
//   a position whose FEN starts with 7k/5Q2/6K1 (stalemate) answers `bestmove (none)`
import { existsSync, unlinkSync } from "node:fs";
import process from "node:process";
import { createInterface } from "node:readline";

const argv = process.argv.slice(2);
const hang = argv.includes("--hang");
const crashAlways = argv.includes("--crash-always");
const crashOnceAt = argv.indexOf("--crash-once");
const crashOnceFile = crashOnceAt >= 0 ? argv[crashOnceAt + 1] : undefined;

let multipv = 1;
let position = "";
const out = (line) => process.stdout.write(`${line}\n`);

createInterface({ input: process.stdin }).on("line", (raw) => {
  const line = raw.trim();
  if (line === "uci") {
    out("id name FakeUCI 1");
    out("id author tests");
    out("option name MultiPV type spin default 1 min 1 max 500");
    out("uciok");
  } else if (line === "isready") {
    out("readyok");
  } else if (line.startsWith("setoption name MultiPV value ")) {
    multipv = Number(line.split(" ").pop());
  } else if (line.startsWith("position ")) {
    position = line;
  } else if (line.startsWith("go")) {
    if (hang) return;
    if (crashAlways) process.exit(3);
    if (crashOnceFile && existsSync(crashOnceFile)) {
      unlinkSync(crashOnceFile);
      process.exit(3);
    }
    if (position.includes("fen 7k/5Q2/6K1")) {
      out("info depth 0 score cp 0");
      out("bestmove (none)");
      return;
    }
    out("info string NNUE evaluation using nn-fake.nnue");
    out("info depth 1 currmove e2e4 currmovenumber 1");
    out("info depth 9 seldepth 12 multipv 1 score cp 80 lowerbound nodes 900 nps 90000 time 10 pv d2d4");
    out("info depth 10 seldepth 14 multipv 1 score cp 35 nodes 1000 nps 100000 hashfull 1 time 10 pv e2e4 e7e5 g1f3");
    if (multipv >= 2) out("info depth 10 seldepth 13 multipv 2 score mate -3 nodes 1000 nps 100000 time 10 pv d2d4 d7d5");
    if (multipv >= 3) out("info depth 10 seldepth 11 multipv 3 score cp -120 wdl 100 200 700 nodes 1000 nps 100000 time 10 pv a2a3");
    out("bestmove e2e4 ponder e7e5");
  } else if (line === "quit") {
    process.exit(0);
  }
});
