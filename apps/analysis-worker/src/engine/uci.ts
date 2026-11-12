// The UCI driver for native Stockfish 18 (phase-03 plan §8.12 pass 1/2, §8.13). One process, one command in flight.
//
//   start      uci → uciok (reads `id name`), setoption Threads/Hash (the sf18-v1 profile), isready → readyok
//   newGame    ucinewgame, isready → readyok (before every pipeline search: src/pipeline/search.ts)
//   search     setoption MultiPV (when it changes), position fen … moves …, go nodes N → bestmove
//
// Parsing keeps the LAST exact `info … multipv k … score … pv …` line per MultiPV index; `lowerbound`/`upperbound`
// lines and `info string`/`currmove` lines are ignored. No `bestmove` within 10 s of `go` → EngineTimeout and the
// process is killed (its state is unknown); the process exiting mid-command → EngineCrashed. The pool (pool.ts)
// restarts and retries once.
//
// The process runs at nice 19 (os.setPriority) as a harmless extra next to the cgroup `cpu.idle` slice (P3-D8).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setPriority } from "node:os";
import { createInterface } from "node:readline";
import type { Logger } from "../obs/log";
import {
  EngineCrashed,
  EngineError,
  EngineTimeout,
  type Engine,
  type EngineLine,
  type EngineScore,
  type SearchRequest,
  type SearchResult,
} from "./types";

/** §8.12 "Failure": no bestmove within 10 s of `go`. */
export const GO_TIMEOUT_MS = 10_000;
export const HANDSHAKE_TIMEOUT_MS = 15_000;
const QUIT_GRACE_MS = 1_000;
export const NICE_LEVEL = 19;

export interface ParsedInfo {
  multipv: number;
  depth: number;
  seldepth: number | null;
  score: EngineScore;
  nodes: number;
  nps: number | null;
  pv: string[];
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][nbrq]?$/;

/**
 * One `info` line → the fields the pipeline uses, or null when the line carries no exact scored PV (a bound, a
 * `currmove` progress line, `info string …`).
 */
export function parseInfoLine(line: string): ParsedInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== "info" || t[1] === "string") return null;
  let multipv = 1;
  let depth: number | null = null;
  let seldepth: number | null = null;
  let score: EngineScore | null = null;
  let nodes = 0;
  let nps: number | null = null;
  let pv: string[] | null = null;
  for (let i = 1; i < t.length; i++) {
    const key = t[i];
    switch (key) {
      case "depth":
        depth = Number(t[++i]);
        break;
      case "seldepth":
        seldepth = Number(t[++i]);
        break;
      case "multipv":
        multipv = Number(t[++i]);
        break;
      case "nodes":
        nodes = Number(t[++i]);
        break;
      case "nps":
        nps = Number(t[++i]);
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
        return null;
      case "pv":
        pv = t.slice(i + 1);
        i = t.length;
        break;
      case "string":
        return null;
      default:
        // time, hashfull, tbhits, currmove, currmovenumber, wdl … : skip the value if it has one
        if (key === "wdl") i += 3;
        else if (i + 1 < t.length && /^-?\d+$/.test(t[i + 1]!)) i++;
        break;
    }
  }
  if (depth === null || !Number.isInteger(depth) || score === null || pv === null || pv.length === 0) return null;
  if (!pv.every((m) => UCI_MOVE.test(m)) || !Number.isInteger(multipv) || multipv < 1) return null;
  return { multipv, depth, seldepth: Number.isInteger(seldepth) ? seldepth : null, score, nodes, nps, pv };
}

/** The `bestmove` of a line ("bestmove e2e4 ponder e7e5" → "e2e4"; "bestmove (none)" → null). */
export function parseBestmove(line: string): string | null | undefined {
  const t = line.trim().split(/\s+/);
  if (t[0] !== "bestmove") return undefined;
  const move = t[1];
  return move && UCI_MOVE.test(move) ? move : null;
}

/** The final exact line per MultiPV index (last wins), sorted by index. */
export function collectLines(infoLines: readonly string[]): { lines: EngineLine[]; nps: number | null } {
  const byIndex = new Map<number, EngineLine>();
  let nps: number | null = null;
  for (const raw of infoLines) {
    const info = parseInfoLine(raw);
    if (!info) continue;
    byIndex.set(info.multipv, {
      multipv: info.multipv,
      score: info.score,
      depth: info.depth,
      seldepth: info.seldepth,
      nodes: info.nodes,
      pv: info.pv,
    });
    if (info.nps !== null && Number.isFinite(info.nps)) nps = info.nps;
  }
  return { lines: [...byIndex.values()].sort((a, b) => a.multipv - b.multipv), nps };
}

export interface UciEngineOptions {
  path: string;
  args?: readonly string[];
  threads: number;
  hashMb: number;
  buildId: string;
  nice?: boolean;
  goTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  log?: Logger;
}

interface Waiter {
  until: (line: string) => boolean;
  lines: string[];
  resolve: (lines: string[]) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class UciEngine implements Engine {
  readonly kind = "stockfish" as const;
  readonly buildId: string;
  name = "";
  private child: ChildProcessWithoutNullStreams | null = null;
  private waiter: Waiter | null = null;
  private dead = true;
  private busy = false;
  /** Set by quit()/kill(): the exit that follows is expected. */
  private stopping = false;
  private multipv = 1;
  private readonly goTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;

  constructor(private readonly opts: UciEngineOptions) {
    this.buildId = opts.buildId;
    this.goTimeoutMs = opts.goTimeoutMs ?? GO_TIMEOUT_MS;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  }

  get alive(): boolean {
    return !this.dead;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  async start(): Promise<void> {
    if (this.child) throw new EngineError("protocol", "engine already started");
    const child = spawn(this.opts.path, [...(this.opts.args ?? [])], {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.opts.env ?? process.env,
    });
    this.child = child;
    this.dead = false;
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (error) => reject(new EngineError("start_failed", `cannot start the engine: ${error.message}`)));
    });
    child.on("exit", (code, signal) => {
      this.dead = true;
      if (this.stopping) this.opts.log?.debug("engine exited", { code, signal });
      else this.opts.log?.warn("engine exited", { code, signal });
      this.fail(new EngineCrashed(`the engine exited (code ${code ?? "-"}, signal ${signal ?? "-"})`));
    });
    child.stdin.on("error", () => this.fail(new EngineCrashed("the engine's stdin closed")));
    child.stderr.resume();
    createInterface({ input: child.stdout }).on("line", (line) => this.onLine(line));
    await spawned;
    if (this.opts.nice !== false && child.pid !== undefined) {
      try {
        setPriority(child.pid, NICE_LEVEL);
      } catch (error) {
        this.opts.log?.warn("engine nice failed", { error });
      }
    }
    const hello = await this.ask("uci", (l) => l === "uciok", this.handshakeTimeoutMs, () => new EngineError("start_failed", "no uciok"));
    this.name = hello.find((l) => l.startsWith("id name "))?.slice("id name ".length).trim() ?? "";
    this.send(`setoption name Threads value ${this.opts.threads}`);
    this.send(`setoption name Hash value ${this.opts.hashMb}`);
    this.send(`setoption name MultiPV value 1`);
    this.multipv = 1;
    await this.ask("isready", (l) => l === "readyok", this.handshakeTimeoutMs, () => new EngineError("start_failed", "no readyok"));
  }

  async newGame(): Promise<void> {
    await this.exclusive(async () => {
      this.send("ucinewgame");
      await this.ask("isready", (l) => l === "readyok", this.handshakeTimeoutMs, () => new EngineTimeout("no readyok after ucinewgame"));
    });
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    if (!Number.isInteger(req.nodes) || req.nodes < 1) throw new RangeError("search: nodes must be a positive integer");
    if (!Number.isInteger(req.multipv) || req.multipv < 1 || req.multipv > 8) throw new RangeError("search: multipv 1..8");
    if (/[\r\n]/.test(req.fen) || (req.moves ?? []).some((m) => !UCI_MOVE.test(m))) {
      throw new RangeError("search: invalid position");
    }
    return this.exclusive(async () => {
      if (req.multipv !== this.multipv) {
        this.send(`setoption name MultiPV value ${req.multipv}`);
        this.multipv = req.multipv;
      }
      const moves = req.moves && req.moves.length > 0 ? ` moves ${req.moves.join(" ")}` : "";
      this.send(`position fen ${req.fen}${moves}`);
      const started = Date.now();
      const out = await this.ask(`go nodes ${req.nodes}`, (l) => l.startsWith("bestmove"), this.goTimeoutMs, () => {
        // Its state is unknown after a timeout: kill it so the pool starts a fresh one.
        this.kill();
        return new EngineTimeout(`no bestmove within ${this.goTimeoutMs} ms`);
      });
      const ms = Date.now() - started;
      const bestLine = out[out.length - 1]!;
      const bestmove = parseBestmove(bestLine) ?? null;
      const { lines, nps } = collectLines(out);
      const first = lines[0];
      return {
        bestmove,
        lines,
        depth: first?.depth ?? 0,
        nodes: Math.max(0, ...lines.map((l) => l.nodes)),
        nps,
        ms,
      };
    });
  }

  kill(): void {
    if (this.child && !this.dead) {
      this.stopping = true;
      this.child.kill("SIGKILL");
    }
  }

  async quit(): Promise<void> {
    const child = this.child;
    if (!child || this.dead) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      child.stdin.write("quit\n");
    } catch {
      // already closed
    }
    const timer = setTimeout(() => this.kill(), QUIT_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }

  // ── plumbing ────────────────────────────────────────────────────────────────────────────────────────────────
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new EngineError("protocol", "the engine is busy (one command at a time)");
    if (this.dead) throw new EngineCrashed("the engine is not running");
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  private send(command: string): void {
    if (!this.child || this.dead || this.child.stdin.destroyed) throw new EngineCrashed("the engine is not running");
    this.child.stdin.write(`${command}\n`);
  }

  private ask(command: string, until: (line: string) => boolean, timeoutMs: number, onTimeout: () => Error): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      if (this.waiter) return reject(new EngineError("protocol", "a command is already waiting"));
      const timer = setTimeout(() => {
        if (this.waiter?.timer === timer) {
          this.waiter = null;
          reject(onTimeout());
        }
      }, timeoutMs);
      this.waiter = { until, lines: [], resolve, reject, timer };
      try {
        this.send(command);
      } catch (error) {
        clearTimeout(timer);
        this.waiter = null;
        reject(error as Error);
      }
    });
  }

  private onLine(line: string): void {
    const w = this.waiter;
    if (!w) return;
    w.lines.push(line);
    if (w.until(line.trim())) {
      clearTimeout(w.timer);
      this.waiter = null;
      w.resolve(w.lines);
    }
  }

  private fail(error: Error): void {
    const w = this.waiter;
    if (!w) return;
    clearTimeout(w.timer);
    this.waiter = null;
    w.reject(error);
  }
}
