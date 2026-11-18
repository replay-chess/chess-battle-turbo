// The J5 engine (phase-06 plan §7.4.5 step 4): the worker's Stockfish 18 run with the worker's `sf18-v1` settings.
// Laptop only (child processes). The UCI exchange mirrors the worker's driver (apps/analysis-worker/src/engine/uci.ts)
// rule for rule, so a search here returns what the worker's search returns for the same position:
//
//   start    uci → uciok, setoption Threads / Hash from ENGINE_PROFILE, MultiPV 1, isready → readyok
//   search   ucinewgame + isready (every search starts from a cleared engine: search.ts in the worker), setoption
//            MultiPV when it changes, position fen <last irreversible FEN> moves <plies since>, go nodes N → bestmove
//   parse    the LAST exact `info … multipv k … score … pv …` line per MultiPV index; bounds, `currmove` and
//            `info string` lines are ignored
//
// The binary runs either inside the worker's Stockfish image (BASELINE_ENGINE_IMAGE, `docker run -i`, one container
// per engine, so the pinned Linux build is the one that searches) or from ENGINE_PATH. pin.ts checks it first.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";

export type EngineScore = { cp: number } | { mate: number };

export interface EngineLine {
  multipv: number;
  depth: number;
  score: EngineScore;
  nodes: number;
  pv: string[];
}

export interface SearchRequest {
  fen: string;
  moves: readonly string[];
  nodes: number;
  multipv: number;
}

export interface SearchResult {
  bestmove: string | null;
  lines: EngineLine[];
  nodes: number;
}

/** How to start the engine binary. */
export type EngineSpec = { kind: "docker"; image: string; binary: string } | { kind: "local"; path: string };

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][nbrq]?$/;
const GO_TIMEOUT_MS = 60_000;

/** One `info` line → its exact scored PV, or null (the worker's parseInfoLine rules). */
export function parseInfoLine(line: string): EngineLine | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== "info" || t[1] === "string") return null;
  let multipv = 1;
  let depth: number | null = null;
  let score: EngineScore | null = null;
  let nodes = 0;
  let pv: string[] | null = null;
  for (let i = 1; i < t.length; i++) {
    const key = t[i];
    switch (key) {
      case "depth":
        depth = Number(t[++i]);
        break;
      case "multipv":
        multipv = Number(t[++i]);
        break;
      case "nodes":
        nodes = Number(t[++i]);
        break;
      case "score": {
        const kind = t[++i];
        const value = Number(t[++i]);
        if ((kind !== "cp" && kind !== "mate") || !Number.isInteger(value)) return null;
        score = kind === "cp" ? { cp: value } : { mate: value };
        break;
      }
      case "lowerbound":
      case "upperbound":
      case "string":
        return null;
      case "pv":
        pv = t.slice(i + 1);
        i = t.length;
        break;
      default:
        if (key === "wdl") i += 3;
        else if (i + 1 < t.length && /^-?\d+$/.test(t[i + 1] as string)) i++;
        break;
    }
  }
  if (depth === null || !Number.isInteger(depth) || score === null || pv === null || pv.length === 0) return null;
  if (!pv.every((m) => UCI_MOVE.test(m)) || !Number.isInteger(multipv) || multipv < 1) return null;
  return { multipv, depth, score, nodes, pv };
}

/** The final exact line per MultiPV index (last wins), sorted by index. */
export function collectLines(info: readonly string[]): EngineLine[] {
  const by = new Map<number, EngineLine>();
  for (const raw of info) {
    const l = parseInfoLine(raw);
    if (l) by.set(l.multipv, l);
  }
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}

/** The arguments of one engine process. */
export function engineCommand(spec: EngineSpec, name: string): { cmd: string; args: string[] } {
  if (spec.kind === "local") return { cmd: spec.path, args: [] };
  return { cmd: "docker", args: ["run", "--rm", "-i", "--init", "--platform", "linux/arm64", "--cpus", "1", "--memory", "512m", "--network", "none", "--name", name, spec.image, spec.binary] };
}

/** One engine process, one command in flight (the worker's driver, see the header). */
export class UciEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private waiters: { test: (l: string) => boolean; resolve: (lines: string[]) => void; reject: (e: Error) => void; lines: string[] }[] = [];
  private multipv = 1;
  /** The engine's `id name`. */
  id = "";
  /** Every `info string` line (the NNUE net names are printed there). */
  readonly infoStrings: string[] = [];

  constructor(
    private readonly spec: EngineSpec,
    private readonly name: string,
  ) {}

  private send(cmd: string): void {
    this.proc?.stdin.write(`${cmd}\n`);
  }

  private ask(cmd: string | null, test: (l: string) => boolean, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`engine ${this.name}: no answer to "${cmd}" within ${timeoutMs} ms`)), timeoutMs);
      this.waiters.push({
        test,
        lines: [],
        resolve: (l) => {
          clearTimeout(timer);
          resolve(l);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      if (cmd !== null) this.send(cmd);
    });
  }

  async start(): Promise<void> {
    const { cmd, args } = engineCommand(this.spec, this.name);
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.proc = p;
    const onLine = (line: string) => {
      if (line.startsWith("info string")) this.infoStrings.push(line);
      if (line.startsWith("id name ")) this.id = line.slice(8).trim();
      const w = this.waiters[0];
      if (!w) return;
      w.lines.push(line);
      if (w.test(line)) {
        this.waiters.shift();
        w.resolve(w.lines);
      }
    };
    // `bench` prints its summary on stderr; everything else arrives on stdout.
    createInterface({ input: p.stdout }).on("line", onLine);
    createInterface({ input: p.stderr }).on("line", onLine);
    p.on("exit", (code) => {
      for (const w of this.waiters.splice(0)) w.reject(new Error(`engine ${this.name} exited (${code})`));
      this.proc = null;
    });
    await this.ask("uci", (l) => l === "uciok", 60_000);
    this.send(`setoption name Threads value ${ENGINE_PROFILE.threads}`);
    this.send(`setoption name Hash value ${ENGINE_PROFILE.hashMb}`);
    this.send("setoption name MultiPV value 1");
    this.multipv = 1;
    await this.ask("isready", (l) => l === "readyok", 60_000);
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    this.send("ucinewgame");
    await this.ask("isready", (l) => l === "readyok", 30_000);
    if (req.multipv !== this.multipv) {
      this.send(`setoption name MultiPV value ${req.multipv}`);
      this.multipv = req.multipv;
    }
    this.send(`position fen ${req.fen}${req.moves.length > 0 ? ` moves ${req.moves.join(" ")}` : ""}`);
    const out = await this.ask(`go nodes ${req.nodes}`, (l) => l.startsWith("bestmove"), GO_TIMEOUT_MS);
    const last = out[out.length - 1] as string;
    const bm = last.trim().split(/\s+/)[1];
    const lines = collectLines(out);
    return { bestmove: bm && UCI_MOVE.test(bm) ? bm : null, lines, nodes: lines[0]?.nodes ?? 0 };
  }

  /** Runs `bench` (default settings) and returns the "Nodes searched" signature. */
  async bench(): Promise<number> {
    const out = await this.ask("bench", (l) => /^Nodes\/second/.test(l.trim()), 300_000);
    const m = out.map((l) => /^Nodes searched\s*:\s*(\d+)/.exec(l.trim())).find(Boolean);
    if (!m) throw new Error("bench printed no node count");
    return Number(m[1]);
  }

  async stop(): Promise<void> {
    const p = this.proc;
    if (!p) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        p.kill("SIGKILL");
        resolve();
      }, 5_000);
      p.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      this.send("quit");
      p.stdin.end();
    });
  }
}

/** N engines and a FIFO of searches. */
export class EnginePool {
  private readonly engines: UciEngine[] = [];
  private readonly idle: UciEngine[] = [];
  private readonly queue: { req: SearchRequest; resolve: (r: SearchResult) => void; reject: (e: Error) => void }[] = [];
  searches = 0;

  constructor(
    private readonly spec: EngineSpec,
    readonly size: number,
  ) {}

  async start(): Promise<void> {
    const tag = `rc-j5-sf-${process.pid}`;
    for (let k = 0; k < this.size; k++) this.engines.push(new UciEngine(this.spec, `${tag}-${k}`));
    await Promise.all(this.engines.map((e) => e.start()));
    this.idle.push(...this.engines);
  }

  first(): UciEngine {
    const e = this.engines[0];
    if (!e) throw new Error("the pool has no engine");
    return e;
  }

  search(req: SearchRequest): Promise<SearchResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const e = this.idle.pop() as UciEngine;
      const job = this.queue.shift()!;
      e.search(job.req).then(
        (r) => {
          this.searches++;
          this.idle.push(e);
          job.resolve(r);
          this.pump();
        },
        (err: Error) => job.reject(err),
      );
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.engines.map((e) => e.stop()));
  }
}
