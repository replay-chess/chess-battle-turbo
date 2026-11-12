// Goldens and label stability for the grading pipeline (phase-03 plan §12.4 "golden/*.json", "Determinism rules",
// TST X13). Ten real games (the first ten of the CC0 Lichess oracle set, packages/chess-analysis/fixtures/oracle) run
// through the worker's own ANALYZE_GAME handler (scripts reuse src/testing/pipeline-harness.ts: the in-memory store, the
// real EnginePool) with the native Stockfish 18 at the frozen `sf18-v1` profile.
//
//   tsx scripts/make-golden.ts --engine <stockfish> --write [--out <dir>]   record (only on a profile or GRADING_VERSION bump)
//   tsx scripts/make-golden.ts --engine <stockfish> --check                 nightly `p3-goldens`: byte-identical or exit 1
//   tsx scripts/make-golden.ts --engine <stockfish> --stability [--report f] nightly `p3-label-stability`
//
// Determinism rules (§12.4): goldens run with the eval cache off, a fresh engine process per game, Threads 1 and no
// resume; "byte-identical" (the canonical JSON of the GameAnalysis fields and every PlayerReview.content) is claimed
// only under those conditions. The stability run is the same ten games with the eval cache warm (a first pass fills
// it) and with a forced failure at ply 20 then the resumed retry; it passes when ≥ 98 % of the plies keep their label,
// every key moment is the same, and each accuracy is within ±0.5 of the golden. On a failure the P3-D10 decision (graded
// positions bypass the cache) is recorded in packages/chess-analysis/README.md.
//
// A golden is `{v, id, source, profile, gradingVersion, engine, startFen, moves, analysis: {evals, …}, reviews}`; the
// eval-provenance check (CA scripts/eval-provenance.ts) reads `startFen`, `moves` and `analysis.evals` from it.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { loadOracleGames } from "@repo/chess-analysis/fixtures/oracle";
import { replaySan } from "@repo/chess-analysis/replay";
import { ENGINE_PROFILE, GRADING_VERSION } from "@repo/chess-analysis/version";
import { BACKOFF_SEC } from "../src/queue/outcome";
import { engineBuildId } from "../src/engine";
import { UciEngine } from "../src/engine/uci";
import type { Engine } from "../src/engine/types";
import { harness, T0, type HarnessOptions } from "../src/testing/pipeline-harness";
import type { MemGame } from "../src/testing/memory-store";
import type { GameMember } from "../src/pipeline/types";

const here = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.resolve(here, "../../../packages/chess-analysis/fixtures/golden");
export const GOLDEN_GAMES = 10;
export const STABILITY = { minLabelAgreement: 0.98, accuracyTolerance: 0.5, crashAtPly: 20 } as const;

export interface Golden {
  v: 1;
  id: string;
  source: string;
  profile: string;
  gradingVersion: number;
  engine: string;
  startFen: string;
  moves: string[];
  analysis: {
    totalPlies: number;
    gradedPlies: number;
    evals: number[];
    second: number[];
    best: number[];
    judgements: number[];
    lines: unknown;
    depthP50: number | null;
    accuracy: unknown;
    counts: unknown;
    middlegamePly: number | null;
    endgamePly: number | null;
  };
  reviews: Record<string, unknown>;
}

/** Stable JSON: keys sorted at every level (what "byte-identical" compares). */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 1);
}

/** The ten oracle games as worker inputs: UCI moves from the initial position, both colours members. */
export function goldenInputs(count = GOLDEN_GAMES): { id: string; source: string; moves: string[]; members: GameMember[] }[] {
  return loadOracleGames()
    .slice(0, count)
    .map((g, i) => {
      const replay = replaySan(INITIAL_FEN, g.moves);
      const result = (side: "white" | "black") => (g.winner === null ? "DRAW" : g.winner === side ? "WIN" : "LOSS");
      return {
        id: g.id,
        source: `lichess-oracle:${g.id}`,
        moves: replay.uci,
        members: [
          { color: "w", userId: String(1000 + 2 * i), userRef: `cgoldenwhite${String(i).padStart(12, "0")}`, result: result("white") },
          { color: "b", userId: String(1001 + 2 * i), userRef: `cgoldenblack${String(i).padStart(12, "0")}`, result: result("black") },
        ] as GameMember[],
      };
    });
}

/** The golden document of one finished in-memory game. */
export function goldenOf(input: { id: string; source: string; moves: string[] }, g: MemGame, engine: string): Golden {
  const a = g.analysis;
  const f = g.final;
  if (!a || !a.completed || !f) throw new Error(`${input.id}: the analysis did not finish (${g.analysisStatus})`);
  return {
    v: 1,
    id: input.id,
    source: input.source,
    profile: ENGINE_PROFILE.id,
    gradingVersion: GRADING_VERSION,
    engine,
    startFen: INITIAL_FEN,
    moves: input.moves,
    analysis: {
      totalPlies: a.totalPlies,
      gradedPlies: a.gradedPlies,
      evals: a.evals,
      second: a.second,
      best: a.best,
      judgements: a.judgements,
      lines: f.lines,
      depthP50: f.depthP50,
      accuracy: f.accuracy,
      counts: f.counts,
      middlegamePly: f.middlegamePly,
      endgamePly: f.endgamePly,
    },
    reviews: Object.fromEntries([...g.reviews.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([c, r]) => [c, r.content])),
  };
}

type EngineMaker = () => Engine;

/** Runs one game to its outcome; `crashAtPly` fails attempt 1 there and runs the resumed retry after the back-off. */
async function runOne(
  input: ReturnType<typeof goldenInputs>[number],
  opts: HarnessOptions & { crashAtPly?: number; warmFirst?: boolean },
): Promise<MemGame> {
  const h = await harness({ ...opts, ...(opts.crashAtPly && !opts.warmFirst ? { fault: { kind: "fail_at_ply", ply: opts.crashAtPly } } : {}) });
  try {
    const ref = `cgolden${input.id.toLowerCase().replace(/[^a-z0-9]/g, "")}`.padEnd(24, "0").slice(0, 24);
    if (opts.warmFirst) {
      // Fill the eval cache with a first, uninterrupted run of the same game (a separate game row).
      h.addGame({ id: "9", ref: `${ref.slice(0, 23)}9`, moves: input.moves, members: input.members, completedAtMs: T0 - 5_000 });
      h.enqueue("9", `${ref.slice(0, 23)}9`);
      const warm = await h.run();
      if (String(warm) !== "done") throw new Error(`${input.id}: the warm-up run ended ${String(warm)}`);
      if (opts.crashAtPly) h.setFault({ kind: "fail_at_ply", ply: opts.crashAtPly });
    }
    h.addGame({ id: "1", ref, moves: input.moves, members: input.members, completedAtMs: T0 - 5_000 });
    h.enqueue("1", ref);
    let outcome = await h.run();
    if (opts.crashAtPly) {
      if (String(outcome) !== "failed") throw new Error(`${input.id}: the forced failure at ply ${opts.crashAtPly} did not happen (${String(outcome)})`);
      await h.clock.advance(BACKOFF_SEC[0] * 1000);
      outcome = await h.run();
    }
    if (String(outcome) !== "done") throw new Error(`${input.id}: the run ended ${String(outcome)}`);
    return h.store.games.get("1")!;
  } finally {
    await h.engine.stop();
  }
}

export interface StabilityResult {
  id: string;
  plies: number;
  sameLabels: number;
  agreement: number;
  momentsEqual: boolean;
  accuracyDelta: number;
  pass: boolean;
}

/** Labels, moments and accuracies of a run against its golden (pure). */
export function compareStability(golden: Golden, run: Golden): StabilityResult {
  const a = golden.analysis.judgements;
  const b = run.analysis.judgements;
  const plies = Math.max(a.length, b.length);
  let same = 0;
  for (let i = 0; i < plies; i++) if (a[i] === b[i]) same++;
  const moments = (g: Golden) =>
    JSON.stringify(Object.fromEntries(Object.entries(g.reviews).map(([c, r]) => [c, ((r as { moments?: { ply: number }[] }).moments ?? []).map((m) => m.ply)])));
  const acc = (g: Golden) => (g.analysis.accuracy ?? {}) as Record<string, number | null>;
  let delta = 0;
  for (const side of ["w", "b"]) {
    const x = acc(golden)[side];
    const y = acc(run)[side];
    if (typeof x === "number" && typeof y === "number") delta = Math.max(delta, Math.abs(x - y));
    else if (x !== y) delta = Number.POSITIVE_INFINITY;
  }
  const agreement = plies === 0 ? 1 : same / plies;
  const momentsEqual = moments(golden) === moments(run);
  return {
    id: golden.id,
    plies,
    sameLabels: same,
    agreement,
    momentsEqual,
    accuracyDelta: delta,
    pass: agreement >= STABILITY.minLabelAgreement && momentsEqual && delta <= STABILITY.accuracyTolerance,
  };
}

export interface Args {
  engine: string;
  mode: "write" | "check" | "stability";
  out: string;
  report: string | null;
  games: number;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { engine: "", mode: "check", out: GOLDEN_DIR, report: null, games: GOLDEN_GAMES };
  let modes = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--engine") out.engine = argv[++i] ?? "";
    else if (a === "--write" || a === "--check" || a === "--stability") {
      out.mode = a.slice(2) as Args["mode"];
      modes++;
    } else if (a === "--out") out.out = path.resolve(argv[++i] ?? "");
    else if (a === "--report") out.report = path.resolve(argv[++i] ?? "");
    else if (a === "--games") out.games = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.engine) throw new Error("--engine <path to stockfish> is required");
  if (modes > 1) throw new Error("pass one of --write, --check, --stability");
  if (!Number.isInteger(out.games) || out.games < 1 || out.games > GOLDEN_GAMES) throw new Error(`--games must be 1..${GOLDEN_GAMES}`);
  return out;
}

function readGoldens(dir: string): Map<string, Golden> {
  const out = new Map<string, Golden>();
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    const g = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Golden;
    out.set(g.id, g);
  }
  return out;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const buildId = engineBuildId(args.engine);
  const engine: EngineMaker = () =>
    new UciEngine({ path: args.engine, threads: ENGINE_PROFILE.threads, hashMb: ENGINE_PROFILE.hashMb, buildId });
  const inputs = goldenInputs(args.games);
  console.log(`make-golden ${args.mode}: ${inputs.length} games, engine ${buildId}, profile ${ENGINE_PROFILE.id}, grading v${GRADING_VERSION}`);

  if (args.mode === "write") {
    mkdirSync(args.out, { recursive: true });
    for (const input of inputs) {
      // A fresh engine process per game, the eval cache off, no resume.
      const g = goldenOf(input, await runOne(input, { engineFactory: engine, cache: false }), buildId);
      writeFileSync(path.join(args.out, `${input.id}.json`), `${canonical(g)}\n`);
      console.log(`  wrote ${input.id}.json (${g.analysis.totalPlies} plies)`);
    }
    return 0;
  }

  const goldens = readGoldens(args.out);
  if (goldens.size === 0) {
    console.error(`no goldens in ${args.out}: record them with --write on the arm64 runner (a profile or GRADING_VERSION bump only)`);
    return 1;
  }
  let failed = 0;
  const report: unknown[] = [];
  for (const input of inputs) {
    const golden = goldens.get(input.id);
    if (!golden) {
      console.error(`  ${input.id}: no golden`);
      failed++;
      continue;
    }
    if (golden.profile !== ENGINE_PROFILE.id || golden.gradingVersion !== GRADING_VERSION) {
      console.error(`  ${input.id}: golden is ${golden.profile} v${golden.gradingVersion}; regenerate after the bump`);
      failed++;
      continue;
    }
    if (args.mode === "check") {
      const run = goldenOf(input, await runOne(input, { engineFactory: engine, cache: false }), golden.engine);
      const same = canonical(run) === canonical(golden);
      report.push({ id: input.id, identical: same });
      console.log(`  ${input.id}: ${same ? "identical" : "DIFFERS"}`);
      if (!same) failed++;
    } else {
      const warm = goldenOf(input, await runOne(input, { engineFactory: engine, cache: true, warmFirst: true }), golden.engine);
      const resumed = goldenOf(input, await runOne(input, { engineFactory: engine, cache: true, crashAtPly: STABILITY.crashAtPly }), golden.engine);
      for (const [kind, run] of [["warm cache", warm], ["crash + resume", resumed]] as const) {
        const r = compareStability(golden, run);
        report.push({ kind, ...r });
        console.log(`  ${input.id} ${kind}: labels ${(r.agreement * 100).toFixed(1)} %, moments ${r.momentsEqual ? "same" : "DIFFER"}, accuracy Δ ${r.accuracyDelta.toFixed(2)}${r.pass ? "" : "  FAIL"}`);
        if (!r.pass) failed++;
      }
    }
  }
  if (args.report) writeFileSync(args.report, `${JSON.stringify({ mode: args.mode, engine: buildId, failed, results: report }, null, 2)}\n`);
  if (failed) console.error(`make-golden ${args.mode}: ${failed} failure(s)`);
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
