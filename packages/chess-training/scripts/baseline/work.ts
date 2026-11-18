// The J5 work directory (laptop only): every intermediate file of a baseline build lives here, never in the repository
// (the dump, the downloaded chunks, the sample checkpoint, the per-side journal, the calibration journal). Each phase
// writes append-only JSONL journals or atomically renamed checkpoints, so a run that is killed resumes where it
// stopped (`build-baseline.ts` reads them back).
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { CellState, SamplerState } from "./sampler";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface WorkDir {
  root: string;
  chunks: string;
  sample: string;
  /** Final reservoirs of closed cells, one line per cell (append-only; the grading phase follows it). */
  closed: string;
  /** This process's grading journal (`graded.jsonl`, or `graded-<k>.jsonl` for shard k). */
  graded: string;
  /** This process's calibration journal (`calibration.jsonl`, or `calibration-<k>.jsonl`). */
  calibration: string;
  log: string;
  /** Shard k of K (BASELINE_SHARD "k/K"): this process grades the cells whose key hashes to k. */
  shard: { k: number; of: number } | null;
}

/** Every journal of a kind (all shards), so readers see every process's lines. */
export function journals(w: WorkDir, kind: "graded" | "calibration"): string[] {
  const re = new RegExp(`^${kind}(-\\d+)?\\.jsonl$`);
  return readdirSync(w.root)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => `${w.root}/${f}`);
}

/** The lines of every journal of a kind. */
export async function* readJournals(w: WorkDir, kind: "graded" | "calibration"): AsyncGenerator<string> {
  for (const path of journals(w, kind)) yield* readLines(path);
}

/** The work directory from BASELINE_WORK_DIR / --work; refuses a directory inside the repository. */
export function workDir(path: string | undefined, shardSpec?: string): WorkDir {
  if (!path) throw new Error("set BASELINE_WORK_DIR (or --work <dir>): a directory outside the repository for the dump and the journals");
  const root = resolve(path);
  const rel = relative(REPO, root);
  if (!rel.startsWith("..") && !rel.startsWith("/")) throw new Error(`the work directory ${root} is inside the repository: use a directory outside it`);
  mkdirSync(`${root}/chunks`, { recursive: true });
  let shard: WorkDir["shard"] = null;
  if (shardSpec) {
    const m = /^(\d+)\/(\d+)$/.exec(shardSpec);
    if (!m || Number(m[1]) >= Number(m[2])) throw new Error(`BASELINE_SHARD must be "k/K" with k < K, got ${shardSpec}`);
    shard = { k: Number(m[1]), of: Number(m[2]) };
  }
  const suffix = shard ? `-${shard.k}` : "";
  return {
    root,
    chunks: `${root}/chunks`,
    sample: `${root}/sample.jsonl`,
    closed: `${root}/closed-cells.jsonl`,
    graded: `${root}/graded${suffix}.jsonl`,
    calibration: `${root}/calibration${suffix}.jsonl`,
    log: `${root}/journal.log`,
    shard,
  };
}

/** One progress line, to the console and the journal (with an ISO timestamp). */
export function journal(w: WorkDir, line: string): void {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(w.log, `${text}\n`);
}

/** What the sample checkpoint stores besides the reservoirs. */
export interface SampleMeta {
  v: 1;
  /** "chunks" (random byte ranges of the dump) or "stream" (the whole decompressed stream on stdin). */
  mode: "chunks" | "stream";
  dump: { name: string; url: string | null; size: number | null; sha256: string | null };
  seed: number;
  cap: number;
  target: number;
  chunkBytes: number;
  /** Chunks fully processed, in processing order. */
  chunksDone: number[];
  /** Stream mode: decompressed bytes consumed. */
  streamBytes: number;
  compressedBytesDecoded: number;
  decompressedBytes: number;
  counts: { games: number; analysed: number; eligible: number; offered: number; reasons: Record<string, number> };
  /** The sample is final (the stop rule fired, the cap was hit, or --close-sample). */
  closed: boolean;
  closedReason: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Writes the checkpoint atomically: line 1 the meta, then one line per cell. */
export async function writeSample(w: WorkDir, meta: SampleMeta, sampler: SamplerState): Promise<void> {
  const tmp = `${w.sample}.tmp`;
  await new Promise<void>((resolveWrite, reject) => {
    const out = createWriteStream(tmp);
    out.on("error", reject);
    out.write(`${JSON.stringify({ meta, cap: sampler.cap, rng: sampler.rng })}\n`);
    for (const [key, cell] of Object.entries(sampler.cells)) out.write(`${JSON.stringify({ key, offers: cell.offers, items: cell.items })}\n`);
    out.end(() => resolveWrite());
  });
  renameSync(tmp, w.sample);
}

/** Reads the checkpoint back, or null when there is none. */
export async function readSample(w: WorkDir): Promise<{ meta: SampleMeta; sampler: SamplerState } | null> {
  if (!existsSync(w.sample)) return null;
  let meta: SampleMeta | null = null;
  let cap = 0;
  let rng = 0;
  const cells: Record<string, CellState> = {};
  for await (const line of readLines(w.sample)) {
    if (meta === null) {
      const head = JSON.parse(line) as { meta: SampleMeta; cap: number; rng: number };
      meta = head.meta;
      cap = head.cap;
      rng = head.rng;
      continue;
    }
    const c = JSON.parse(line) as { key: string } & CellState;
    cells[c.key] = { offers: c.offers, items: c.items };
  }
  if (!meta) return null;
  return { meta, sampler: { cap, rng, cells } };
}

/** The lines of a text file (async, any size). */
export async function* readLines(path: string): AsyncGenerator<string> {
  if (!existsSync(path)) return;
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim() !== "") yield line;
}

/** Appends one JSON record to a journal. */
export function appendJsonl(path: string, record: unknown): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/** Writes a small JSON file atomically. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`; // per process: shards may write the same file

  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}
