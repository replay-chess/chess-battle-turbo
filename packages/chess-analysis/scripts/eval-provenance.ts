// Eval provenance (phase-03 plan §12.4, TST X13): every stored eval in the grading corpora must stay within ±30 cp of
// Stockfish 18 at profile sf18-v1, or give the same mate distance, so the fixtures cannot drift from the real engine.
//
//   ENGINE_PATH=/usr/local/bin/stockfish tsx scripts/eval-provenance.ts [--write] [--report <file.json>] [--limit n]
//
// Checked: `packages/chess-fixtures/grades/positions.jsonl` (every line whose `source` is not `constructed` or
// `design-mock`: the position before and after the move), `fixtures/labels/**/*.json` files whose `provenance` is not
// `constructed` (every position of every game), and `fixtures/golden/*.json` when the worker's goldens exist (every
// position; a golden is `{startFen, moves, evals}` with `moves` UCI as a string or array, or the same under
// `analysis`). The design mock (`labels/design-mock.ts`) is a TypeScript fixture of design values and is never read.
//
// The engine runs the sf18-v1 pass-1 search exactly (ENGINE_PROFILE: Threads 1, Hash 64, MultiPV 2, `go nodes`
// 120000), `ucinewgame` before every position. A terminal position is not searched: checkmate is a mate in 0,
// stalemate and other dead draws are 0.
//
// `--write` rewrites drifted `positions.jsonl` lines with the engine's evals (source `sf18-v1`, the Win% loss
// recomputed). Expected labels are never touched: the corpus test then shows any label the new evals flip, for a
// person to review. Exit code: 0 when everything is within tolerance (or was rewritten), 1 on drift, 2 on a usage or
// engine error. Runs nightly on the arm64 runner with the worker's engine build (WP-H's `p3-eval-provenance` job).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { decodeEval, encodeMate, evalFor, fromEngineScore, type Color } from "../src/codec";
import { ENGINE_PROFILE } from "../src/version";
import { winPct } from "../src/winpct";

const here = path.dirname(fileURLToPath(import.meta.url));
export const POSITIONS_FILE = path.resolve(here, "../../chess-fixtures/grades/positions.jsonl");
export const LABELS_DIR = path.resolve(here, "../fixtures/labels");
export const GOLDEN_DIR = path.resolve(here, "../fixtures/golden");
/** Centipawn tolerance (§12.4). */
export const CP_TOLERANCE = 30;
/** Sources whose evals are set by hand on purpose and are not engine facts. */
export const EXEMPT_SOURCES: ReadonlySet<string> = new Set(["constructed", "design-mock"]);

export interface Check {
  /** Where the eval is stored ("positions.jsonl:fools-mate-g4:before"). */
  where: string;
  fen: string;
  stored: number;
}

export type EngineScore = { cp: number } | { mate: number };

/** The `score` and `multipv` of a UCI `info` line; null for lines without a final score (bounds are ignored). */
export function parseInfo(line: string): { multipv: number; score: EngineScore } | null {
  if (!line.startsWith("info ") || / (lowerbound|upperbound)( |$)/.test(line)) return null;
  const m = / score (cp|mate) (-?\d+)/.exec(line);
  if (!m) return null;
  const mpv = / multipv (\d+)/.exec(line);
  const n = Number(m[2]);
  return { multipv: mpv ? Number(mpv[1]) : 1, score: m[1] === "cp" ? { cp: n } : { mate: n } };
}

/** Whether a stored eval agrees with the engine's: both centipawns within ±30, or the same mate. */
export function withinTolerance(stored: number, engine: number): boolean {
  const a = decodeEval(stored);
  const b = decodeEval(engine);
  if (a.kind === "cp" && b.kind === "cp") return Math.abs(a.cp - b.cp) <= CP_TOLERANCE;
  if (a.kind === "mate" && b.kind === "mate") return a.winner === b.winner && a.moves === b.moves;
  return false;
}

/** The stored eval of a terminal position, or null when the position has legal moves. */
export function terminalEval(fen: string): number | null {
  const c = new Chess(fen);
  if (c.moves().length > 0) return null;
  if (c.isCheckmate()) return encodeMate(c.turn() === "w" ? "b" : "w", 0);
  return 0;
}

interface PositionRow {
  id: string;
  fen: string;
  move: string;
  evalBefore: number;
  evalAfter: number;
  source: string;
  expected: { label: string; winPctLossApprox: number };
  [k: string]: unknown;
}

function fenAfterSan(fen: string, san: string): string {
  const c = new Chess(fen);
  c.move(san);
  return c.fen();
}

/** The checks of positions.jsonl (exempt sources skipped). */
export function positionChecks(file = POSITIONS_FILE): Check[] {
  const out: Check[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (raw.trim() === "") continue;
    const row = JSON.parse(raw) as PositionRow;
    if (EXEMPT_SOURCES.has(row.source)) continue;
    out.push({ where: `positions.jsonl:${row.id}:before`, fen: row.fen, stored: row.evalBefore });
    out.push({ where: `positions.jsonl:${row.id}:after`, fen: fenAfterSan(row.fen, row.move), stored: row.evalAfter });
  }
  return out;
}

function gamePositions(startFen: string, moves: readonly string[], san: boolean): string[] {
  const c = new Chess(startFen);
  const fens = [c.fen()];
  for (const m of moves) {
    if (san) c.move(m);
    else c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    fens.push(c.fen());
  }
  return fens;
}

function jsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonFiles(p));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out.sort();
}

/** The checks of the label fixtures (`provenance: "constructed"` files skipped). */
export function labelChecks(dir = LABELS_DIR): Check[] {
  const out: Check[] = [];
  for (const file of jsonFiles(dir)) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as {
      provenance?: string;
      games?: { id: string; startFen: string; moves: string[]; evals: number[] }[];
    };
    if (doc.provenance === "constructed" || doc.provenance === "design-mock") continue;
    for (const g of doc.games ?? []) {
      gamePositions(g.startFen, g.moves, true).forEach((fen, i) => {
        const stored = g.evals[i];
        if (stored !== undefined) out.push({ where: `${path.basename(file)}:${g.id}:${i}`, fen, stored });
      });
    }
  }
  return out;
}

/** The checks of the worker's golden analyses, when they exist. */
export function goldenChecks(dir = GOLDEN_DIR): Check[] {
  const out: Check[] = [];
  for (const file of jsonFiles(dir)) {
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const src = (doc.analysis && typeof doc.analysis === "object" ? doc.analysis : doc) as Record<string, unknown>;
    const startFen = (doc.startFen ?? src.startFen) as string | undefined;
    const rawMoves = (doc.moves ?? src.moves) as string | string[] | undefined;
    const evals = src.evals as number[] | undefined;
    if (!startFen || rawMoves === undefined || !evals)
      throw new Error(`${file}: a golden needs startFen, moves, evals`);
    const moves = typeof rawMoves === "string" ? rawMoves.split(" ").filter(Boolean) : rawMoves;
    gamePositions(startFen, moves, false).forEach((fen, i) => {
      const stored = evals[i];
      if (stored !== undefined) out.push({ where: `golden/${path.basename(file)}:${i}`, fen, stored });
    });
  }
  return out;
}

/** A UCI engine running the sf18-v1 pass-1 search. */
export class UciEngine {
  private buf = "";
  private waiters: { test: (l: string) => boolean; resolve: (l: string) => void; lines: string[] }[] = [];

  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const w of this.waiters) w.lines.push(line);
        const done = this.waiters.findIndex((w) => w.test(line));
        if (done >= 0) {
          const [w] = this.waiters.splice(done, 1);
          w!.resolve(line);
        }
      }
    });
  }

  static async start(command: string, args: readonly string[] = []): Promise<UciEngine> {
    const e = new UciEngine(spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] }));
    await e.ask("uci", (l) => l === "uciok");
    e.send(`setoption name Threads value ${ENGINE_PROFILE.threads}`);
    e.send(`setoption name Hash value ${ENGINE_PROFILE.hashMb}`);
    e.send(`setoption name MultiPV value ${ENGINE_PROFILE.pass1.multipv}`);
    await e.ask("isready", (l) => l === "readyok");
    return e;
  }

  private send(cmd: string): void {
    this.proc.stdin.write(`${cmd}\n`);
  }

  private ask(cmd: string, until: (line: string) => boolean, timeoutMs = 60_000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const w = {
        test: until,
        lines: [] as string[],
        resolve: () => {
          clearTimeout(timer);
          resolve(w.lines);
        },
      };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new Error(`engine timeout after "${cmd}"`));
      }, timeoutMs);
      this.waiters.push(w);
      this.send(cmd);
    });
  }

  /** The sf18-v1 pass-1 eval of a position, stored encoding (White POV). */
  async evaluate(fen: string): Promise<number> {
    const terminal = terminalEval(fen);
    if (terminal !== null) return terminal;
    this.send("ucinewgame");
    await this.ask("isready", (l) => l === "readyok");
    this.send(`position fen ${fen}`);
    const lines = await this.ask(`go nodes ${ENGINE_PROFILE.pass1.nodes}`, (l) => l.startsWith("bestmove"));
    let last: EngineScore | null = null;
    for (const l of lines) {
      const info = parseInfo(l);
      if (info && info.multipv === 1) last = info.score;
    }
    if (!last) throw new Error(`no score for ${fen}`);
    return fromEngineScore(last, new Chess(fen).turn() as Color);
  }

  async stop(): Promise<void> {
    this.send("quit");
    await new Promise<void>((resolve) => {
      if (this.proc.exitCode !== null) resolve();
      else this.proc.once("exit", () => resolve());
    });
  }
}

export interface Drift extends Check {
  engine: number;
}

/** Runs every check through the engine; returns the drifted ones. */
export async function runChecks(
  engine: { evaluate(fen: string): Promise<number> },
  checks: readonly Check[],
): Promise<{ drift: Drift[]; engineEvals: Map<string, number> }> {
  const drift: Drift[] = [];
  const engineEvals = new Map<string, number>();
  for (const c of checks) {
    const e = engineEvals.get(c.fen) ?? (await engine.evaluate(c.fen));
    engineEvals.set(c.fen, e);
    if (!withinTolerance(c.stored, e)) drift.push({ ...c, engine: e });
  }
  return { drift, engineEvals };
}

/** Rewrites drifted positions.jsonl lines with the engine's evals (labels untouched). Returns the ids rewritten. */
export function rewritePositions(drift: readonly Drift[], file = POSITIONS_FILE): string[] {
  const byId = new Map<string, { before?: number; after?: number }>();
  for (const d of drift) {
    const m = /^positions\.jsonl:(.+):(before|after)$/.exec(d.where);
    if (!m) continue;
    const entry = byId.get(m[1] as string) ?? {};
    entry[m[2] as "before" | "after"] = d.engine;
    byId.set(m[1] as string, entry);
  }
  const lines = readFileSync(file, "utf8").split("\n");
  const out = lines.map((raw) => {
    if (raw.trim() === "") return raw;
    const row = JSON.parse(raw) as PositionRow;
    const fix = byId.get(row.id);
    if (!fix) return raw;
    const mover = new Chess(row.fen).turn() as Color;
    const evalBefore = fix.before ?? row.evalBefore;
    const evalAfter = fix.after ?? row.evalAfter;
    const loss = Math.max(0, winPct(evalFor(evalBefore, mover)) - winPct(evalFor(evalAfter, mover)));
    return JSON.stringify({
      ...row,
      evalBefore,
      evalAfter,
      expected: { ...row.expected, winPctLossApprox: Math.round(loss * 10000) / 10000 },
      source: "sf18-v1",
    });
  });
  writeFileSync(file, out.join("\n"));
  return [...byId.keys()];
}

async function main(argv: readonly string[]): Promise<number> {
  const enginePath = process.env.ENGINE_PATH;
  if (!enginePath) {
    console.error("eval-provenance: set ENGINE_PATH to a Stockfish 18 binary");
    return 2;
  }
  const write = argv.includes("--write");
  const reportAt = argv.indexOf("--report");
  const limitAt = argv.indexOf("--limit");
  let checks = [...positionChecks(), ...labelChecks(), ...goldenChecks()];
  if (limitAt >= 0) checks = checks.slice(0, Number(argv[limitAt + 1]));
  const engine = await UciEngine.start(enginePath);
  let result;
  try {
    result = await runChecks(engine, checks);
  } finally {
    await engine.stop();
  }
  const report = {
    profile: ENGINE_PROFILE.id,
    nodes: ENGINE_PROFILE.pass1.nodes,
    checked: checks.length,
    drift: result.drift.map((d) => ({ where: d.where, fen: d.fen, stored: d.stored, engine: d.engine })),
  };
  if (reportAt >= 0) writeFileSync(argv[reportAt + 1] as string, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `eval-provenance: ${checks.length} evals checked, ${result.drift.length} outside ±${CP_TOLERANCE} cp / mate`,
  );
  for (const d of result.drift) console.log(`  ${d.where}: stored ${d.stored}, engine ${d.engine}`);
  if (result.drift.length === 0) return 0;
  if (!write) return 1;
  const rewritten = rewritePositions(result.drift);
  const other = result.drift.filter((d) => !d.where.startsWith("positions.jsonl:"));
  console.log(
    `eval-provenance: rewrote ${rewritten.length} positions.jsonl lines; ${other.length} drifted evals elsewhere`,
  );
  return other.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
