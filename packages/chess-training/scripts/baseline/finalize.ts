// J5 phase 4 (phase-06 plan §7.4.5 steps 5–7): the journals → `baselines/v1.json` + `baselines/v1.meta.json`.
import { writeFileSync } from "node:fs";
import type { BaselineMetaV1 } from "../../baselines/schema";
import { aggregateCell, baselineJson, buildBaseline, calibrationOf } from "./aggregate";
import { closedCells, gradeOrder, sideId } from "./grade";
import { BAND_KEYS, MIN_PLIES, SAMPLE_TIME_CLASSES, SKIPPED_TERMINATIONS } from "./pgn";
import type { PinFacts } from "./pin";
import type { CalibrationRecord, PositionFacts, SideRecord } from "./side";
import { readJournals, readSample, type WorkDir } from "./work";

export interface FinalizeOptions {
  samplePerCell: number;
  seed: number;
  calibrationSidesPerCell: number;
  calibrationTimeClass: string;
  closeFactor: number;
  closeMinChunks: number;
  pin: PinFacts;
  start: PositionFacts;
  phases: BaselineMetaV1["runtime"]["phases"];
  threads: number;
  outJson: string;
  outMeta: string;
  builtAt: string;
}

/** Cells at or above 2300 may be short (plan §13 WP2); anything else short is reported as such. */
function shortfallReason(cell: string, offers: number, chunks: number, held: number): string {
  const band = Number(cell.split(":")[0]);
  if (band >= 2300) return `scarce at 2300+: ${offers} eligible sides were offered over the ${chunks} chunks read (the reservoir held ${held})`;
  return `the ${chunks} chunks read offered ${offers} eligible sides (the reservoir held ${held}); the cell closed when the sample stopped`;
}

export async function finalize(w: WorkDir, o: FinalizeOptions): Promise<{ meta: BaselineMetaV1; json: string }> {
  const sample = await readSample(w);
  if (!sample?.meta.closed) throw new Error("the sample is not closed yet (phase 1)");
  const sm = sample.meta;
  if (!sm.dump.sha256) throw new Error("the sample has no published dump sha256 (LICHESS_DUMP_SHA256)");
  const closed = await closedCells(w);
  const journalled = new Map<string, SideRecord>();
  const skippedIds = new Set<string>();
  for await (const line of readJournals(w, "graded")) {
    const r = JSON.parse(line) as SideRecord | { key: string; id: string; color: string; skip: string };
    if ("skip" in r) skippedIds.add(sideId(r.key, r.id, r.color));
    else journalled.set(sideId(r.key, r.id, r.color), r);
  }
  // A cell's sample: the first samplePerCell sides of its grade order that graded (a uniform subsample of the
  // reservoir; the sides that could not be graded are counted, and the next ones in the order take their place).
  const cells = new Map<string, SideRecord[]>();
  const skipped = new Map<string, number>();
  let searches = 0;
  for (const c of closed) {
    const list: SideRecord[] = [];
    for (const it of gradeOrder(c.key, c.items, o.seed)) {
      if (list.length >= o.samplePerCell) break;
      const id = sideId(c.key, it.id, it.color);
      if (skippedIds.has(id)) {
        skipped.set(c.key, (skipped.get(c.key) ?? 0) + 1);
        continue;
      }
      const r = journalled.get(id);
      if (!r) throw new Error(`cell ${c.key}: side ${it.id}:${it.color} is not graded yet: run --grade first`);
      list.push(r);
      searches += r.searches;
    }
    cells.set(c.key, list);
  }
  const offersOf = new Map(closed.map((c) => [c.key, c.offers]));
  const sampled = new Map(closed.map((c) => [c.key, c.items.length]));
  const calib: CalibrationRecord[] = [];
  for await (const line of readJournals(w, "calibration")) {
    const r = JSON.parse(line) as CalibrationRecord | { skip: string };
    if (!("skip" in r)) {
      calib.push(r);
      searches += r.searches;
    }
  }
  const calibration = calibrationOf(calib);
  const games = new Set([...cells.values()].flatMap((rs) => rs.map((r) => r.id))).size;
  const baseline = buildBaseline({ cells, calibration: calibration.factors, dump: sm.dump.name, games, builtAt: o.builtAt });
  const metaCells: BaselineMetaV1["cells"] = {};
  const shortfalls: BaselineMetaV1["shortfalls"] = [];
  for (const band of BAND_KEYS)
    for (const tc of SAMPLE_TIME_CLASSES) {
      const key = `${band}:${tc}`;
      const rs = cells.get(key) ?? [];
      const moves = aggregateCell(rs).moves;
      metaCells[key] = { sides: rs.length, moves, offers: offersOf.get(key) ?? 0, skipped: skipped.get(key) ?? 0 };
      if (rs.length < o.samplePerCell)
        shortfalls.push({ cell: key, sides: rs.length, moves, reason: shortfallReason(key, offersOf.get(key) ?? 0, sm.chunksDone.length, sampled.get(key) ?? 0) });
    }
  const meta: BaselineMetaV1 = {
    v: 1,
    id: baseline.id,
    profile: baseline.profile,
    algoVersion: baseline.algoVersion,
    gradingVersion: baseline.gradingVersion,
    builtAt: o.builtAt,
    engine: {
      engine: o.pin.engine,
      tag: o.pin.tag,
      commit: o.pin.commit,
      binarySha256: o.pin.binarySha256,
      buildId: o.pin.buildId,
      nets: o.pin.nets,
      benchNodes: o.pin.benchNodes,
      threads: o.pin.threads,
      hashMb: o.pin.hashMb,
      pass1: o.pin.pass1,
      runner: o.pin.runner,
    },
    dump: {
      name: sm.dump.name,
      url: sm.dump.url,
      sha256Published: sm.dump.sha256,
      sha256Verified: false,
      size: sm.dump.size,
      mode: sm.mode,
      seed: sm.seed,
      chunkBytes: sm.chunkBytes,
      chunks: sm.chunksDone,
      compressedBytesDecoded: sm.compressedBytesDecoded,
      decompressedBytes: sm.decompressedBytes,
      games: sm.counts.games,
      analysed: sm.counts.analysed,
      eligible: sm.counts.eligible,
      offered: sm.counts.offered,
      closedReason: sm.closedReason ?? "unknown",
    },
    sampling: {
      samplePerCell: o.samplePerCell,
      closeFactor: o.closeFactor,
      closeMinChunks: o.closeMinChunks,
      rules: [
        "standard, rated, both Elo values, no BOT title on either side",
        "%eval on every ply (one short when the game ends in mate) and %clk on every ply",
        `at least ${MIN_PLIES} plies; not from a set-up position`,
        "time class from initial + 40 × increment: < 180 s bullet, < 480 blitz, < 1500 rapid (classical and correspondence skipped)",
        `terminations skipped: ${[...SKIPPED_TERMINATIONS].join(", ")}`,
        "one side per game: the side whose cell has seen fewer offers (ties: a bit of the game id's FNV-1a hash)",
        "per-cell Algorithm-R reservoirs over the chunks read, chunks in a seeded random order across the month",
        `a cell closes once it has seen closeFactor × samplePerCell offers over ≥ closeMinChunks chunks`,
      ],
    },
    cells: metaCells,
    shortfalls,
    calibration: { timeClass: o.calibrationTimeClass, sidesPerCell: o.calibrationSidesPerCell, detail: calibration.detail },
    notes: [
      "Evals are Lichess's %eval (the worker's eval-hint path for imported Lichess games); position 0 is our engine's (start facts below).",
      `Start position: eval ${o.start.eval}, best ${o.start.best ?? "none"} (sf18-v1 pass 1).`,
      "Each MISTAKE / BLUNDER / MISS position was searched with sf18-v1 pass 1 (120k nodes, MultiPV 2); its MultiPV-1 PV is the tagger's best line (the worker stores the pass-2 PV for its ≤ 6 pass-2 plies and the pass-1 best move elsewhere).",
      "The position after each error was searched the same way: its best move is the refutation (rc:missedThreat), as the worker's pass 1 gives it.",
      "Pass 2 (1M nodes on ≤ 6 key positions) is not re-run: the %eval values stand everywhere, so evalSource is LICHESS for every sampled side.",
      "Calibration grades the calibration sides with sf18-v1 pass 1 on every position (no pass 2) and compares judgement rates per graded move with the %eval grading of the same sides.",
      "ratingOffsets.CHESSCOM are 0 in v1 [V] (D-P6-5).",
    ],
    runtime: { phases: o.phases, searches, threads: o.threads },
  };
  const json = baselineJson(baseline);
  writeFileSync(o.outJson, json);
  writeFileSync(o.outMeta, `${JSON.stringify(meta, null, 1)}\n`);
  return { meta, json };
}
