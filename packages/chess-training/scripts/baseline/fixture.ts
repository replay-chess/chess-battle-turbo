// FX `weakness/baseline-sample.json` (phase-06 plan §12.5): 50 real sampled sides of the v1 build with the engine's
// answers the pipeline used and the per-side records it produced, so the J5 pipeline and aggregation are tested
// without the dump or the engine. Written by `build-baseline.ts --sample-fixture` from a finished work directory: the
// chosen sides are searched again with the pinned engine; the file keeps those answers and the records they give, and
// counts how many equal the journalled ones (`reproduced`).
import { writeFileSync } from "node:fs";
import type { BookSet } from "@repo/chess-analysis/book";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import type { EnginePool } from "./engine";
import { closedCells, gradeOrder, sideId } from "./grade";
import { BAND_KEYS, KEPT_HEADERS, SAMPLE_TIME_CLASSES } from "./pgn";
import type { SampleItem } from "./sampler";
import { factsOf, finishSide, prepareSide, type PositionFacts, type SideRecord } from "./side";
import { readJournals, type WorkDir } from "./work";

export interface BaselineSampleSide {
  item: SampleItem;
  /** The engine's facts for every searched position, by position index. */
  facts: Record<string, PositionFacts>;
  record: SideRecord;
}

export interface BaselineSampleFile {
  v: 1;
  about: string;
  dump: { name: string; sha256Published: string };
  engine: { buildId: string; profile: string; binarySha256: string };
  /**
   * How many of the sides the second search reproduced byte for byte (fixed nodes, one thread, a cleared engine per
   * search: Stockfish 18 still returns a different PV for a few positions, about 0.4 % of searches here). The fixture
   * stores the answers of the second search and the record they give, so the test is exact either way.
   */
  reproduced: number;
  start: PositionFacts;
  sides: BaselineSampleSide[];
}

/** Headers the fixture keeps (no names, no dates: the per-side pipeline never reads them). */
const FIXTURE_HEADERS = KEPT_HEADERS.filter((h) => h !== "Site" && h !== "UTCDate" && h !== "UTCTime");

/** 50 sides spread over the cells: every time class, bands from 600 to 2400 (pure on the graded set). */
export function pickFixtureSides(byKey: ReadonlyMap<string, readonly SampleItem[]>, n = 50): SampleItem[] {
  const keys = BAND_KEYS.flatMap((b, i) => SAMPLE_TIME_CLASSES.filter((_, k) => (i + k) % 3 !== 2).map((tc) => `${b}:${tc}`));
  const out: SampleItem[] = [];
  for (let round = 0; out.length < n && round < 10; round++)
    for (const key of keys) {
      const it = byKey.get(key)?.[round];
      if (it && out.length < n) out.push(it);
    }
  return out;
}

export async function writeSampleFixture(
  w: WorkDir,
  o: { pool: EnginePool; book: BookSet; start: PositionFacts; seed: number; perCell: number; out: string; dump: { name: string; sha256Published: string }; engine: BaselineSampleFile["engine"] },
): Promise<BaselineSampleFile> {
  const journalled = new Map<string, SideRecord>();
  for await (const line of readJournals(w, "graded")) {
    const r = JSON.parse(line) as SideRecord | { skip: string };
    if (!("skip" in r)) journalled.set(sideId(r.key, r.id, r.color), r);
  }
  const byKey = new Map<string, SampleItem[]>();
  for (const c of await closedCells(w))
    byKey.set(
      c.key,
      gradeOrder(c.key, c.items, o.seed)
        .slice(0, o.perCell)
        .filter((it) => journalled.has(sideId(c.key, it.id, it.color))),
    );
  const picked = pickFixtureSides(byKey);
  const sides: BaselineSampleSide[] = [];
  let reproduced = 0;
  for (const [k, item] of picked.entries()) {
    const p = prepareSide(item, o.start, o.book);
    if (!p.ok) throw new Error(`fixture side ${item.id}: ${p.reason}`);
    const facts = new Map<number, PositionFacts>();
    for (const need of p.side.needs) {
      const r = await o.pool.search({ fen: need.fen, moves: need.moves, nodes: ENGINE_PROFILE.pass1.nodes, multipv: ENGINE_PROFILE.pass1.multipv });
      facts.set(need.index, factsOf(r, p.side.replay.fens[need.index]?.split(" ")[1] === "b" ? "b" : "w"));
    }
    const record = finishSide(p.side, facts);
    const before = journalled.get(sideId(record.key, record.id, record.color));
    if (JSON.stringify(before) === JSON.stringify(record)) reproduced++;
    const anon = `s${String(k + 1).padStart(2, "0")}`;
    const headers: Record<string, string> = {};
    for (const h of FIXTURE_HEADERS) if (item.headers[h] !== undefined) headers[h] = item.headers[h] as string;
    sides.push({
      item: { ...item, id: anon, headers },
      facts: Object.fromEntries([...facts].map(([i, f]) => [String(i), f])),
      record: { ...record, id: anon },
    });
  }
  const file: BaselineSampleFile = {
    v: 1,
    about:
      "50 sides of the J5 v1 sample (Lichess open database, CC0; players' names, game ids and dates removed): the PGN movetext with Lichess's %eval and %clk, the pinned engine's answers for every position the pipeline searched, and the per-side record (the five game_players inputs) build-baseline.ts produced. Regenerate only with build-baseline.ts --sample-fixture after a reviewed change.",
    dump: o.dump,
    engine: o.engine,
    reproduced,
    start: o.start,
    sides,
  };
  const { sides: list, ...head } = file;
  const text = `${JSON.stringify(head).slice(0, -1)},"sides":[\n${list.map((x) => JSON.stringify(x)).join(",\n")}\n]}\n`;
  writeFileSync(o.out, text);
  return file;
}
