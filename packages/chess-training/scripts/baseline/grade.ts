// J5 phases 2 and 3 (phase-06 plan §7.4.5 steps 4 and 6): the sampled sides through the worker's pipeline with the
// pinned engine, journalled one line per side (resumable), and the calibration sides graded a second time with our
// engine on every position. Laptop only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBookSet, parseOpeningsTsv, type BookSet } from "@repo/chess-analysis/book";
import { INITIAL_FEN } from "@repo/chess-analysis/board";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import type { EnginePool } from "./engine";
import { fnv1a, subsample, type SampleItem } from "./sampler";
import { calibrationNeeds, calibrationRecord, factsOf, finishSide, prepareSide, type PositionFacts, type PreparedSide, type SearchNeed } from "./side";
import { appendJsonl, journal, readJournals, readLines, readSample, writeJsonAtomic, type WorkDir } from "./work";

const OPENINGS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/public/openings");

/** The worker's opening book: the `openings` lines the dev seed loads (apps/web/public/openings/*.tsv, CC0). */
export function loadBook(dir = OPENINGS): { book: BookSet; lines: number; failures: number } {
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsv")).sort();
  const pgns = files.flatMap((f) => parseOpeningsTsv(readFileSync(`${dir}/${f}`, "utf8")).map((l) => l.pgn));
  const b = buildBookSet(pgns);
  return { book: b.book, lines: b.lines, failures: b.failures.length };
}

/** Our engine's facts for the initial position (position 0 of every sampled game), searched once and kept. */
export async function startFacts(w: WorkDir, pool: EnginePool): Promise<PositionFacts> {
  const path = `${w.root}/start.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as PositionFacts;
  const r = await pool.search({ fen: INITIAL_FEN, moves: [], nodes: ENGINE_PROFILE.pass1.nodes, multipv: ENGINE_PROFILE.pass1.multipv });
  const f = factsOf(r, "w");
  writeJsonAtomic(path, f);
  return f;
}

/** Searches every need of a side with the pass-1 budget. */
async function searchAll(pool: EnginePool, p: PreparedSide, needs: readonly SearchNeed[]): Promise<Map<number, PositionFacts>> {
  const out = new Map<number, PositionFacts>();
  await Promise.all(
    needs.map(async (need) => {
      const r = await pool.search({ fen: need.fen, moves: need.moves, nodes: ENGINE_PROFILE.pass1.nodes, multipv: ENGINE_PROFILE.pass1.multipv });
      const mover = p.replay.fens[need.index]?.split(" ")[1] === "b" ? "b" : "w";
      out.set(need.index, factsOf(r, mover));
    }),
  );
  return out;
}

/** Whether this process (shard) grades the side (`sideId`), so the shards stay balanced within every cell. */
export function mine(w: WorkDir, id: string): boolean {
  return w.shard === null || fnv1a(id) % w.shard.of === w.shard.k;
}

export const sideId = (key: string, id: string, color: string) => `${key}|${id}|${color}`;

/**
 * The order a closed cell's sides are graded in: a seeded random permutation of its reservoir (per cell), so the first
 * N graded sides are a uniform subsample of it and a build can grade N per cell first and extend later (resumable).
 */
export function gradeOrder(key: string, items: readonly SampleItem[], seed: number): SampleItem[] {
  return subsample(items, items.length, (seed ^ fnv1a(key)) >>> 0);
}

/** Runs `work` over `items` with at most `limit` in flight. */
async function bounded<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await work(items[i] as T);
    }
  });
  await Promise.all(lanes);
}

/** The closed cells published so far (sample.ts), in publication order. */
export async function closedCells(w: WorkDir): Promise<{ key: string; offers: number; closedAt: number; items: SampleItem[] }[]> {
  const out: { key: string; offers: number; closedAt: number; items: SampleItem[] }[] = [];
  for await (const line of readLines(w.closed)) out.push(JSON.parse(line) as (typeof out)[number]);
  return out;
}

/** Ids already journalled by any shard (graded or skipped), and which of them were skipped. */
async function journalState(w: WorkDir, kind: "graded" | "calibration"): Promise<{ done: Set<string>; skipped: Set<string> }> {
  const done = new Set<string>();
  const skipped = new Set<string>();
  for await (const line of readJournals(w, kind)) {
    const r = JSON.parse(line) as { key: string; id: string; color: string; skip?: string };
    const id = sideId(r.key, r.id, r.color);
    done.add(id);
    if (r.skip !== undefined) skipped.add(id);
  }
  return { done, skipped };
}

/**
 * A cell's sample: the first `perCell` sides of its grade order that grade, skipping the ones that cannot be graded
 * (an illegal SAN or an eval gap the screen missed), so a cell with enough offers always reaches `perCell`.
 */
export function cellSample(key: string, items: readonly SampleItem[], seed: number, perCell: number, skipped: ReadonlySet<string>): SampleItem[] {
  const out: SampleItem[] = [];
  for (const it of gradeOrder(key, items, seed)) {
    if (out.length >= perCell) break;
    if (!skipped.has(sideId(key, it.id, it.color))) out.push(it);
  }
  return out;
}

export interface GradeOptions {
  pool: EnginePool;
  book: BookSet;
  start: PositionFacts;
  /** Keep polling for newly closed cells until the sample is closed. */
  follow: boolean;
  pollMs: number;
  /** Sides graded per cell (the first N of gradeOrder). */
  perCell: number;
  seed: number;
}

/** Phase 2: every side of every closed cell → graded.jsonl (resumes; a side that cannot be prepared is journalled as a skip). */
export async function runGrade(w: WorkDir, o: GradeOptions): Promise<void> {
  const { done, skipped } = await journalState(w, "graded");
  let gradedNow = 0;
  let searches = 0;
  const t0 = Date.now();
  for (;;) {
    const cells = await closedCells(w);
    const todo = cells
      .flatMap((c) => cellSample(c.key, c.items, o.seed, o.perCell, skipped))
      .filter((it) => mine(w, sideId(`${it.band}:${it.tc}`, it.id, it.color)) && !done.has(sideId(`${it.band}:${it.tc}`, it.id, it.color)));
    if (todo.length > 0) {
      journal(w, `grade: ${todo.length} sides to grade (${done.size} journalled, ${cells.length} cells closed)`);
      await bounded(todo, o.pool.size * 4, async (item) => {
        const key = `${item.band}:${item.tc}`;
        const prepared = prepareSide(item, o.start, o.book);
        if (!prepared.ok) {
          appendJsonl(w.graded, { v: 1, key, id: item.id, color: item.color, skip: prepared.reason });
          skipped.add(sideId(key, item.id, item.color));
        } else {
          const facts = await searchAll(o.pool, prepared.side, prepared.side.needs);
          appendJsonl(w.graded, finishSide(prepared.side, facts));
          searches += prepared.side.needs.length;
        }
        done.add(sideId(key, item.id, item.color));
        gradedNow++;
        if (gradedNow % 500 === 0) {
          const rate = gradedNow / ((Date.now() - t0) / 3_600_000);
          journal(w, `grade: ${gradedNow} sides this run (${Math.round(rate)}/h, ${searches} searches, ${done.size} journalled)`);
        }
      });
      continue;
    }
    const sample = await readSample(w);
    if (!o.follow || (sample?.meta.closed && cells.length >= Object.keys(sample.sampler.cells).length)) break;
    await new Promise((r) => setTimeout(r, o.pollMs));
  }
  if (gradedNow > 0) journal(w, `grade: done (${gradedNow} sides this run, ${searches} searches, ${done.size} journalled)`);
}

export const CALIBRATION_SIDES_PER_CELL = 300;
export const CALIBRATION_TIME_CLASS = "BLITZ";

export interface CalibrateOptions {
  pool: EnginePool;
  book: BookSet;
  start: PositionFacts;
  perCell: number;
  seed: number;
}

/** Phase 3: the blitz calibration sides with our engine on every position → calibration.jsonl (resumes). */
export async function runCalibrate(w: WorkDir, o: CalibrateOptions): Promise<void> {
  const { done } = await journalState(w, "calibration");
  const { skipped } = await journalState(w, "graded");
  const cells = (await closedCells(w)).filter((c) => c.key.endsWith(`:${CALIBRATION_TIME_CLASS}`));
  const todo = cells
    .flatMap((c) => cellSample(c.key, c.items, o.seed, o.perCell, skipped))
    .filter((it) => mine(w, sideId(`${it.band}:${it.tc}`, it.id, it.color)))
    .filter((it) => !done.has(sideId(`${it.band}:${it.tc}`, it.id, it.color)));
  if (todo.length === 0) return;
  journal(w, `calibrate: ${todo.length} sides to grade on every position (${done.size} journalled)`);
  let n = 0;
  const t0 = Date.now();
  await bounded(todo, o.pool.size * 2, async (item) => {
    const key = `${item.band}:${item.tc}`;
    const prepared = prepareSide(item, o.start, o.book);
    if (!prepared.ok) appendJsonl(w.calibration, { v: 1, key, id: item.id, color: item.color, skip: prepared.reason });
    else {
      const facts = await searchAll(o.pool, prepared.side, calibrationNeeds(prepared.side));
      appendJsonl(w.calibration, calibrationRecord(prepared.side, facts, o.book));
    }
    n++;
    if (n % 200 === 0) journal(w, `calibrate: ${n}/${todo.length} (${Math.round(n / ((Date.now() - t0) / 3_600_000))}/h)`);
  });
  if (n > 0) journal(w, `calibrate: done (${n} sides this run)`);
}
