// Task C1 bench (phase-03 plan §8.13, P3-D9): `stockfish bench` plus a cold 60-ply sample at the sf18-v1 budget,
// i.e. what one 60-ply game costs with an empty eval cache: pass 1 (61 positions × N nodes, MultiPV 2) and pass 2
// (6 positions × 1M nodes, MultiPV 3, stopped at 60 s). Prints JSON (and writes it with --out).
//
//   tsx scripts/bench.ts --engine <path> [--pass1-nodes 120000] [--compare 80000] [--out bench.json]
//   docker run --rm --cpus 0.75 <worker image> node dist/bench.cjs --out /tmp/bench.json        (the dev-VM gate)
//
// Gate (§8.13): ≥ 60 games/hour on the dev VM at 0.75 core with the socket's loop-lag p99 < 50 ms; if it fails,
// pass 1 drops to 80k nodes before any golden is recorded (`--compare 80000` measures that alternative).
//
// This is the engine-only half (one cold game, no queue, no database). The §12.7 gate on the running worker, "enqueue
// 60 fixture games at BACKLOG → ≥ 60 games/hour, the cache hit ratio, 0 per-game emits", and the co-location run with
// k6 ws-ramp are `scripts/worker-flood.ts`; `bench.ts --queue [flood args]` runs it (FIX-1).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cpus, arch, platform } from "node:os";
import { Chess } from "chess.js";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { engineBuildId } from "../src/engine";
import { UciEngine } from "../src/engine/uci";
import { main as floodMain } from "./worker-flood";

/** lichess.org/0E2JOKCO (rapid, from the CA accuracy oracle), the first 60 plies. */
export const SAMPLE_SAN =
  "d4 g6 h4 d5 h5 Nf6 hxg6 fxg6 c4 c5 e3 cxd4 exd4 Bg7 Bh6 Bxh6 Rxh6 Nc6 c5 e5 Bb5 O-O Bxc6 bxc6 f3 exd4 Qxd4 Qe7+ " +
  "Ne2 Ba6 Nc3 Rae8 O-O-O Bxe2 Re1 Qg7 Reh1 Nh5 Qd2 Ba6 g4 Nf6 Qg5 Rf7 Qd2 Qf8 Qh2 Qxc5 Rxg6+ Kh8 Rh6 d4 Rxf6 Qg5+ " +
  "f4 Qxf6 f5 dxc3 b3 Re2";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** Pass-2 sample positions (the plan's ≤ 6 per game: moment, brilliant and divergence candidates). */
const PASS2_PLIES = [20, 28, 36, 44, 52, 60];

export function sampleUci(): string[] {
  const chess = new Chess();
  return SAMPLE_SAN.split(" ").map((san) => {
    const m = chess.move(san);
    return `${m.from}${m.to}${m.promotion ?? ""}`;
  });
}

export interface BenchArgs {
  engine: string;
  pass1Nodes: number;
  compare: number | null;
  out: string | null;
  skipBench: boolean;
}

export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): BenchArgs {
  const args: BenchArgs = {
    engine: env.ENGINE_PATH ?? "/usr/local/bin/stockfish",
    pass1Nodes: ENGINE_PROFILE.pass1.nodes,
    compare: null,
    out: null,
    skipBench: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--engine") args.engine = value();
    else if (a === "--pass1-nodes") args.pass1Nodes = Number(value());
    else if (a === "--compare") args.compare = Number(value());
    else if (a === "--out") args.out = value();
    else if (a === "--skip-bench") args.skipBench = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const n of [args.pass1Nodes, args.compare ?? 1]) if (!Number.isInteger(n) || n < 1) throw new Error("node counts must be positive integers");
  return args;
}

/** `stockfish bench` (default: 16 MB hash, 1 thread, depth 13): its summary is on stderr. */
export function parseBenchOutput(text: string): { nodes: number; nps: number; ms: number } {
  const grab = (label: string) => {
    const m = new RegExp(`${label}\\s*:\\s*(\\d+)`).exec(text);
    if (!m) throw new Error(`bench output has no "${label}"`);
    return Number(m[1]);
  };
  return { ms: grab("Total time \\(ms\\)"), nodes: grab("Nodes searched"), nps: grab("Nodes/second") };
}

function runBench(path: string): Promise<{ nodes: number; nps: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, ["bench"], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (d: Buffer) => (text += d.toString()));
    child.stderr.on("data", (d: Buffer) => (text += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`stockfish bench exited ${code}`));
      try {
        resolve(parseBenchOutput(text));
      } catch (error) {
        reject(error as Error);
      }
    });
  });
}

async function sample(path: string, pass1Nodes: number) {
  const engine = new UciEngine({
    path,
    threads: ENGINE_PROFILE.threads,
    hashMb: ENGINE_PROFILE.hashMb,
    buildId: engineBuildId(path),
    nice: false,
    goTimeoutMs: 120_000,
  });
  await engine.start();
  const uci = sampleUci();
  try {
    await engine.newGame();
    const p1Start = Date.now();
    let nodes = 0;
    const depths: number[] = [];
    for (let i = 0; i <= uci.length; i++) {
      const r = await engine.search({ fen: START, moves: uci.slice(0, i), nodes: pass1Nodes, multipv: ENGINE_PROFILE.pass1.multipv });
      nodes += r.nodes;
      depths.push(r.depth);
    }
    const pass1Ms = Date.now() - p1Start;
    const p2Start = Date.now();
    let pass2Positions = 0;
    for (const ply of PASS2_PLIES) {
      if (Date.now() - p2Start > ENGINE_PROFILE.pass2.maxSeconds * 1000) break;
      await engine.search({ fen: START, moves: uci.slice(0, ply), nodes: ENGINE_PROFILE.pass2.nodes, multipv: ENGINE_PROFILE.pass2.multipv });
      pass2Positions++;
    }
    const pass2Ms = Date.now() - p2Start;
    depths.sort((a, b) => a - b);
    const totalMs = pass1Ms + pass2Ms;
    return {
      plies: uci.length,
      pass1: { nodesPerPosition: pass1Nodes, positions: uci.length + 1, nodes, ms: pass1Ms, depthP50: depths[Math.floor(depths.length / 2)] },
      pass2: { positions: pass2Positions, ms: pass2Ms },
      totalMs,
      gamesPerHour: Math.floor(3_600_000 / totalMs),
    };
  } finally {
    await engine.quit();
  }
}

export async function main(argv = process.argv.slice(2), env: Readonly<Record<string, string | undefined>> = process.env) {
  if (argv[0] === "--queue") {
    const code = await floodMain(argv.slice(1), env);
    if (code !== 0) throw new Error("the queue throughput gate failed (see the report)");
    return;
  }
  const args = parseArgs(argv, env);
  const probe = new UciEngine({ path: args.engine, threads: 1, hashMb: 16, buildId: engineBuildId(args.engine), nice: false });
  await probe.start();
  const name = probe.name;
  await probe.quit();
  const result = {
    at: new Date().toISOString(),
    host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? "unknown", cores: cpus().length },
    engine: { name, buildId: engineBuildId(args.engine) },
    profile: ENGINE_PROFILE.id,
    bench: args.skipBench ? null : await runBench(args.engine),
    sample: await sample(args.engine, args.pass1Nodes),
    compare: args.compare ? await sample(args.engine, args.compare) : null,
    gate: { gamesPerHourMin: 60 },
  };
  const json = JSON.stringify(result, null, 2);
  if (args.out) writeFileSync(args.out, `${json}\n`);
  process.stdout.write(`${json}\n`);
}

const isEntry = typeof require !== "undefined" ? require.main === module : process.argv[1]?.endsWith("bench.ts");
if (isEntry) {
  main().catch((error: unknown) => {
    process.stderr.write(`bench failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
