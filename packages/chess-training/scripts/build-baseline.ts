// J5: builds the rating-band baseline (phase-06 plan §7.4.5, §8.4, §12.5; runbook docs/runbooks/weakness-baseline.md).
// Laptop only (Node built-ins, curl, Docker). Every intermediate file lives in the work directory (BASELINE_WORK_DIR or
// --work), never in the repository; each phase resumes from its journal.
//
//   tsx scripts/build-baseline.ts --synthetic [--check]     v0-synthetic.json from scripts/synthetic-baseline.ts
//   tsx scripts/build-baseline.ts --pin-check               the engine pin only (binary, nets, bench, profile)
//   tsx scripts/build-baseline.ts --sample                  phase 1: dump chunks → per-cell reservoirs
//   zstd -dc <dump> | tsx scripts/build-baseline.ts --sample --stdin    phase 1 over the whole stream
//   tsx scripts/build-baseline.ts --grade                   phase 2: every sampled side through the worker's pipeline
//   tsx scripts/build-baseline.ts --calibrate               phase 3 alone: our engine on every ply of the calibration
//                                                           sides of the closed blitz cells (--grade runs it too)
//   tsx scripts/build-baseline.ts --aggregate               phase 4: v1.json + v1.meta.json
//   tsx scripts/build-baseline.ts --all                     phases 1–4 (each resumes)
//   tsx scripts/build-baseline.ts --sample-fixture          FX weakness/baseline-sample.json (50 graded sides)
//   tsx scripts/build-baseline.ts --close-sample            stop phase 1 after the chunk in progress
//   tsx scripts/build-baseline.ts --golden --update         test/fixtures/weakness/member-design.v1.golden.json
//                                                           (computeWeakness of the design member with v1; review the diff)
//
// Environment (plan §7.7): LICHESS_DUMP_URL or LICHESS_DUMP_PATH (a local .pgn.zst), LICHESS_DUMP_SHA256 (the
// published sha256 of the month), ENGINE_PATH (a local Stockfish) or BASELINE_ENGINE_IMAGE (the worker's Stockfish
// stage image, run with Docker), BASELINE_SAMPLE_PER_CELL (2000), BASELINE_THREADS, BASELINE_WORK_DIR,
// BASELINE_RESERVOIR (reservoir capacity per cell, ≥ the per-cell sample; default the sample),
// BASELINE_SAMPLE_TARGET (offers every cell below 2300 must see before chunk sampling stops; default the sample),
// BASELINE_SEED, BASELINE_CHUNK_MB (96), BASELINE_MAX_CHUNKS, BASELINE_DOWNLOADS (parallel range requests, 3),
// BASELINE_SHARD ("k/K": --grade / --calibrate run as K processes, each grading the cells whose key hashes to k, with
// its own journal; the CPU side of a side — grading, the tagger — is single-threaded per process),
// BASELINE_CLOSE_FACTOR (4) and BASELINE_CLOSE_MIN_CHUNKS (8): a cell's reservoir is final once it has seen
// factor × cap offers over at least that many chunks (sampler.ts), so grading starts while scarce cells still fill.
// Search nodes and MultiPV come from ENGINE_PROFILE (CA version.ts), never from the environment.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { remoteSize, type DumpSource } from "./baseline/dump";
import { EnginePool, type EngineSpec } from "./baseline/engine";
import { finalize } from "./baseline/finalize";
import { writeSampleFixture } from "./baseline/fixture";
import { CALIBRATION_SIDES_PER_CELL, CALIBRATION_TIME_CLASS, closedCells, loadBook, runCalibrate, runGrade, startFacts } from "./baseline/grade";
import { checkFiles, checkRunning, pinFacts, type PinFacts } from "./baseline/pin";
import { exemptHighBands, runSample } from "./baseline/sample";
import { readSample, journal, workDir, writeJsonAtomic, type WorkDir } from "./baseline/work";
import { syntheticBaselineJson } from "./synthetic-baseline";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINES = resolve(here, "../baselines");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = (name: string): string | undefined => {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
};
const int = (name: string, fallback: number): number => {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
};

/** The per-cell sample size (plan default 2000; the runbook's floor is 1000). */
export const SAMPLE_PER_CELL_DEFAULT = 2000;
export const SAMPLE_PER_CELL_MIN = 1000;

function synthetic(): void {
  const out = resolve(BASELINES, "v0-synthetic.json");
  const json = syntheticBaselineJson();
  if (flag("--check")) {
    if (readFileSync(out, "utf8") !== json) {
      console.error("v0-synthetic.json is stale: run scripts/build-baseline.ts --synthetic");
      process.exit(1);
    }
    console.log("v0-synthetic.json is current");
    return;
  }
  writeFileSync(out, json);
  console.log(`wrote ${out} (${json.length} bytes)`);
}

async function dumpSource(): Promise<{ source: DumpSource | null; name: string }> {
  if (flag("--stdin")) {
    const name = env("LICHESS_DUMP_NAME") ?? env("LICHESS_DUMP_PATH") ?? env("LICHESS_DUMP_URL");
    if (!name) throw new Error("--stdin needs LICHESS_DUMP_NAME (or LICHESS_DUMP_PATH / LICHESS_DUMP_URL) to record which month it is");
    return { source: null, name: basename(name) };
  }
  const path = env("LICHESS_DUMP_PATH");
  if (path) {
    if (!existsSync(path)) throw new Error(`LICHESS_DUMP_PATH ${path} does not exist`);
    const { statSync } = await import("node:fs");
    return { source: { kind: "file", path, size: statSync(path).size }, name: basename(path) };
  }
  const url = env("LICHESS_DUMP_URL");
  if (!url) throw new Error("set LICHESS_DUMP_URL or LICHESS_DUMP_PATH (or pipe the stream with --stdin)");
  if (!/^https:\/\/database\.lichess\.org\/standard\/lichess_db_standard_rated_20\d\d-\d\d\.pgn\.zst$/.test(url))
    throw new Error("LICHESS_DUMP_URL must be a standard rated monthly dump on database.lichess.org");
  return { source: { kind: "url", url, size: await remoteSize(url) }, name: basename(url) };
}

async function sample(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"));
  const { source, name } = await dumpSource();
  const perCell = int("BASELINE_SAMPLE_PER_CELL", SAMPLE_PER_CELL_DEFAULT);
  if (perCell < SAMPLE_PER_CELL_MIN) throw new Error(`BASELINE_SAMPLE_PER_CELL below ${SAMPLE_PER_CELL_MIN} is not a baseline`);
  const cap = int("BASELINE_RESERVOIR", perCell);
  if (cap < perCell) throw new Error("BASELINE_RESERVOIR must be at least BASELINE_SAMPLE_PER_CELL");
  const sha256 = env("LICHESS_DUMP_SHA256") ?? null;
  if (sha256 !== null && !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("LICHESS_DUMP_SHA256 must be 64 hex characters");
  journal(w, `sample: ${name} (${source ? `${source.kind}, ${source.size} bytes` : "stdin stream"}), ${perCell} sides per cell, reservoir ${cap}`);
  phaseMark(w, "sample", "start");
  const meta = await runSample(w, {
    dumpName: name,
    source,
    sha256,
    seed: int("BASELINE_SEED", 20261017),
    cap,
    target: int("BASELINE_SAMPLE_TARGET", perCell),
    chunkBytes: int("BASELINE_CHUNK_MB", 96) * 1024 * 1024,
    maxChunks: int("BASELINE_MAX_CHUNKS", 400),
    concurrency: int("BASELINE_DOWNLOADS", 3),
    exempt: exemptHighBands,
    closeFactor: int("BASELINE_CLOSE_FACTOR", 4),
    closeMinChunks: int("BASELINE_CLOSE_MIN_CHUNKS", 8),
  });
  journal(w, `sample: done (${meta.closedReason})`);
  if (meta.closed) phaseMark(w, "sample", "end");
}

function engineSpec(): EngineSpec {
  const image = env("BASELINE_ENGINE_IMAGE");
  if (image) return { kind: "docker", image, binary: env("BASELINE_ENGINE_BINARY") ?? "/out/stockfish" };
  const path = env("ENGINE_PATH");
  if (path) return { kind: "local", path };
  throw new Error("set BASELINE_ENGINE_IMAGE (the worker's Stockfish image) or ENGINE_PATH");
}

/** BASELINE_THREADS engines (default: the CPU count minus 4, at least 1). */
async function threads(): Promise<number> {
  const { availableParallelism } = await import("node:os");
  return int("BASELINE_THREADS", Math.max(1, availableParallelism() - 4));
}

type Phases = Record<string, { startedAt: string; finishedAt: string | null; hours: number | null }>;

function phases(w: WorkDir): Phases {
  const path = `${w.root}/phases.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Phases) : {};
}

function phaseMark(w: WorkDir, name: string, edge: "start" | "end"): void {
  const p = phases(w);
  const now = new Date().toISOString();
  const cur = p[name];
  if (edge === "start") p[name] = { startedAt: cur?.startedAt ?? now, finishedAt: null, hours: null };
  else if (cur) p[name] = { ...cur, finishedAt: now, hours: Math.round(((Date.parse(now) - Date.parse(cur.startedAt)) / 3_600_000) * 100) / 100 };
  writeJsonAtomic(`${w.root}/phases.json`, p);
}

/** Checks the pin (refuses to go on otherwise) and starts the pool. */
async function pinnedPool(w: WorkDir, size: number): Promise<{ pool: EnginePool; pin: PinFacts }> {
  const spec = engineSpec();
  const files = checkFiles(spec);
  const pool = new EnginePool(spec, size);
  await pool.start();
  const bench = await checkRunning(pool.first());
  const pin = pinFacts(files, bench, spec);
  writeJsonAtomic(`${w.root}/pin.json`, pin);
  journal(w, `engine pin ok: ${pin.engine} ${pin.commit.slice(0, 12)} binary ${pin.binarySha256.slice(0, 12)} bench ${pin.benchNodes} profile ${pin.profile}; ${size} engines (${pin.runner})`);
  return { pool, pin };
}

/** Phases 2 + 3: grade every closed cell as it closes; calibrate the blitz cells; until the sample is closed and done. */
async function engineWork(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"), env("BASELINE_SHARD"));
  const { pool } = await pinnedPool(w, await threads());
  const { book, lines, failures } = loadBook();
  journal(w, `book: ${lines} opening lines, ${book.size} positions (${failures} lines stop early)`);
  const start = await startFacts(w, pool);
  const follow = !flag("--no-follow");
  const gradeOpts = { pool, book, start, follow: false, pollMs: 0, perCell: int("BASELINE_SAMPLE_PER_CELL", SAMPLE_PER_CELL_DEFAULT), seed: int("BASELINE_SEED", 20261017) };
  phaseMark(w, "grade", "start");
  try {
    for (;;) {
      await runGrade(w, gradeOpts);
      if (!flag("--skip-calibration")) {
        phaseMark(w, "calibrate", "start");
        await runCalibrate(w, { pool, book, start, perCell: CALIBRATION_SIDES_PER_CELL, seed: int("BASELINE_SEED", 20261017) });
      }
      const sample = await readSample(w);
      const cells = await closedCells(w);
      const all = sample !== null && sample.meta.closed && cells.length >= Object.keys(sample.sampler.cells).length;
      if (all) {
        await runGrade(w, gradeOpts);
        if (!flag("--skip-calibration")) await runCalibrate(w, { pool, book, start, perCell: CALIBRATION_SIDES_PER_CELL, seed: int("BASELINE_SEED", 20261017) });
        phaseMark(w, "grade", "end");
        if (!flag("--skip-calibration")) phaseMark(w, "calibrate", "end");
        break;
      }
      if (!follow) break;
      await new Promise((r) => setTimeout(r, 60_000));
    }
  } finally {
    await pool.stop();
  }
}

/** Phase 3 alone, over the blitz cells closed so far (resumable). */
async function calibrateOnly(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"), env("BASELINE_SHARD"));
  const { pool } = await pinnedPool(w, await threads());
  try {
    const { book } = loadBook();
    const start = await startFacts(w, pool);
    phaseMark(w, "calibrate", "start");
    await runCalibrate(w, { pool, book, start, perCell: CALIBRATION_SIDES_PER_CELL, seed: int("BASELINE_SEED", 20261017) });
  } finally {
    await pool.stop();
  }
}

async function aggregateCmd(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"));
  const pinPath = `${w.root}/pin.json`;
  const startPath = `${w.root}/start.json`;
  if (!existsSync(pinPath) || !existsSync(startPath)) throw new Error("no pin.json / start.json in the work directory: run --grade first");
  const { meta } = await finalize(w, {
    samplePerCell: int("BASELINE_SAMPLE_PER_CELL", SAMPLE_PER_CELL_DEFAULT),
    seed: int("BASELINE_SEED", 20261017),
    calibrationSidesPerCell: CALIBRATION_SIDES_PER_CELL,
    calibrationTimeClass: CALIBRATION_TIME_CLASS,
    closeFactor: int("BASELINE_CLOSE_FACTOR", 4),
    closeMinChunks: int("BASELINE_CLOSE_MIN_CHUNKS", 8),
    pin: JSON.parse(readFileSync(pinPath, "utf8")) as PinFacts,
    start: JSON.parse(readFileSync(startPath, "utf8")) as Parameters<typeof finalize>[1]["start"],
    phases: phases(w),
    threads: await threads(),
    outJson: resolve(BASELINES, "v1.json"),
    outMeta: resolve(BASELINES, "v1.meta.json"),
    builtAt: env("BASELINE_BUILT_AT") ?? new Date().toISOString().slice(0, 10),
  });
  journal(w, `aggregate: wrote v1.json and v1.meta.json (${meta.shortfalls.length} short cells, ${meta.runtime.searches} searches)`);
}

/** FX weakness/baseline-sample.json from a finished work directory (re-searched and checked against the journal). */
async function sampleFixture(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"));
  const sample = await readSample(w);
  if (!sample?.meta.closed || !sample.meta.dump.sha256) throw new Error("the sample is not closed (or has no published sha256)");
  const { pool, pin } = await pinnedPool(w, await threads());
  try {
    const { book } = loadBook();
    const out = resolve(opt("--fixture-out") ?? resolve(here, "../../chess-fixtures/weakness/baseline-sample.json"));
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dirname(out), { recursive: true });
    const file = await writeSampleFixture(w, {
      pool,
      book,
      start: await startFacts(w, pool),
      seed: int("BASELINE_SEED", 20261017),
      perCell: int("BASELINE_SAMPLE_PER_CELL", SAMPLE_PER_CELL_DEFAULT),
      out,
      dump: { name: sample.meta.dump.name, sha256Published: sample.meta.dump.sha256 },
      engine: { buildId: pin.buildId, profile: pin.profile, binarySha256: pin.binarySha256 },
    });
    journal(w, `sample-fixture: wrote ${out} (${file.sides.length} sides, ${file.reproduced} reproduced the journalled record exactly)`);
  } finally {
    await pool.stop();
  }
}

/** The v1 golden of the design member (plan §12.1 compute.golden, the nightly dev check's reference). */
async function golden(): Promise<void> {
  if (!flag("--update")) throw new Error("--golden rewrites a reviewed fixture: pass --update as well");
  const { loadBaseline } = await import("../baselines/load");
  const { computeWeakness } = await import("../src/weakness/compute");
  const { fromJson } = await import("../test/gen");
  const dir = resolve(here, "../test/fixtures/weakness");
  const md = JSON.parse(readFileSync(resolve(dir, "member-design.json"), "utf8")) as import("../test/member-design").MemberDesign;
  const out = computeWeakness(md.games.map(fromJson), loadBaseline("v1"), { now: new Date(md.now), timeZone: md.timeZone, profile: md.profile, ratingBand: md.ratingBand });
  writeFileSync(resolve(dir, "member-design.v1.golden.json"), `${JSON.stringify(out, null, 1)}\n`);
  console.log("wrote member-design.v1.golden.json (review the diff before committing)");
}

async function pinCheck(): Promise<void> {
  const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"));
  const { pool } = await pinnedPool(w, 1);
  await pool.stop();
}

async function main(): Promise<void> {
  if (flag("--synthetic")) return synthetic();
  if (flag("--pin-check")) return pinCheck();
  if (flag("--grade")) return engineWork();
  if (flag("--calibrate")) return calibrateOnly();
  if (flag("--aggregate")) return aggregateCmd();
  if (flag("--sample-fixture")) return sampleFixture();
  if (flag("--golden")) return golden();
  if (flag("--all")) {
    await Promise.all([sample(), engineWork()]);
    return aggregateCmd();
  }
  if (flag("--close-sample")) {
    const w = workDir(opt("--work") ?? env("BASELINE_WORK_DIR"));
    writeFileSync(`${w.root}/close-sample`, new Date().toISOString());
    journal(w, "sample: close requested");
    return;
  }
  if (flag("--sample")) return sample();
  console.error("usage: see the header of scripts/build-baseline.ts");
  process.exit(2);
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
