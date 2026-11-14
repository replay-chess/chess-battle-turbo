// build-shards.ts (phase-05 plan §8.13): the dump filter, the top-K buckets, the bitmask, the shard/manifest files,
// `verify` and the CI `subset`. Rows are real CC0 Lichess puzzles (database.lichess.org) plus edited copies that must be
// filtered out or dropped as illegal.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { PICKER_THEMES, shardBitsTable } from "@repo/chess-training/themes";
import {
  checkShard,
  maskHas,
  MAX_THEME_BITS,
  MIX_THEME,
  PuzzleManifestSchema,
  themesOfMask,
} from "../../lib/train/puzzle-shards";
import {
  BITS,
  collect,
  finish,
  headerIndex,
  parseRow,
  readManifest,
  readShard,
  serialiseManifest,
  SHARD_THEMES,
  subsetOf,
  TopK,
  verifyDir,
  writeBuild,
  type Row,
} from "./build-shards";

const HEADER = "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate";
const GOOD = [
  "000Pw,6k1/5p1p/4p3/4q3/3nN3/2Q3P1/PP3P1P/6K1 w - - 2 37,e4d2 d4e2 g1f1 e2c3,1514,76,92,631,crushing endgame fork short,https://lichess.org/x,,",
  "0017R,r2qk2r/pp2ppbp/1n1p2p1/3Pn3/2P5/2NBBP1P/PP3P2/R2QK2R b KQkq - 0 12,e5c4 d3c4 b6c4 d1a4 d8d7 a4c4,1494,77,95,6647,advantage fork long middlegame,https://lichess.org/x,,",
  "003S3,r4k1r/pNqnppb1/6pn/2p3Np/7P/2P2Q2/PP3PP1/R1B1K2R b KQ - 2 15,a8b8 g5e6 f8g8 e6c7,1415,75,95,15244,advantage middlegame pin short,https://lichess.org/x,,",
  "003Tx,2r5/pR5p/5p1k/4p3/4r3/B4nPP/PP3P2/1K2R3 w - - 0 27,e1e4 f3d2 b1a1 c8c1,1510,88,83,772,backRankMate endgame fork mate mateIn2 short,https://lichess.org/x,,",
  "005Bm,4rk2/p1q5/1p3Q1b/8/1p5N/2P1p3/P3P3/2K5 b - - 0 43,c7f7 h4g6 f8g8 f6h8,1476,74,96,6849,endgame mate mateIn2 pin short,https://lichess.org/x,,",
  "006pe,r4r2/2q1NN2/4bQpk/2n4p/pp5P/8/1PP2PP1/2KR3R b - - 0 28,e6f7 e7f5 h6h7 f6g7,1560,76,96,5851,master mate mateIn2 middlegame pin short,https://lichess.org/x,,",
];
const FEN0 = "6k1/5p1p/4p3/4q3/3nN3/2Q3P1/PP3P1P/6K1 w - - 2 37";
const REJECTED = [
  `LowPp,${FEN0},e4d2 d4e2 g1f1 e2c3,1514,76,79,631,fork,u,,`, // popularity 79
  `FewPl,${FEN0},e4d2 d4e2 g1f1 e2c3,1514,76,92,299,fork,u,,`, // 299 plays
  `HighD,${FEN0},e4d2 d4e2 g1f1 e2c3,1514,91,92,631,fork,u,,`, // RD 91
  `Low59,${FEN0},e4d2 d4e2 g1f1 e2c3,599,76,92,631,fork,u,,`, // rating 599
  `Hi260,${FEN0},e4d2 d4e2 g1f1 e2c3,2600,76,92,631,fork,u,,`, // rating 2600
  `Long1,${FEN0},${Array(16).fill("e4d2").join(" ")},1514,76,92,631,fork,u,,`, // 16 tokens
  `x!bad,${FEN0},e4d2 d4e2 g1f1 e2c3,1514,76,92,631,fork,u,,`, // bad id
];
const ILLEGAL = `ZZZZZ,${FEN0},e4d2 d4e2 g1f1 e2e8,1530,76,99,9999,fork short,u,,`;

async function* lines(rows: string[]): AsyncIterable<string> {
  for (const r of rows) yield r;
}

const tmp = mkdtempSync(path.join(tmpdir(), "rc-shards-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe("theme bits", () => {
  it("are the taxonomy's table (≤ 53 bits), cover every shard theme, and never name mix or rc:*", () => {
    assert.deepEqual(BITS, shardBitsTable());
    assert.ok(Object.values(BITS).every((b) => b < MAX_THEME_BITS));
    assert.equal(new Set(Object.values(BITS)).size, Object.keys(BITS).length);
    assert.equal(SHARD_THEMES.length, 30);
    assert.equal(new Set(SHARD_THEMES).size, 30);
    for (const t of SHARD_THEMES) assert.ok(t in BITS, `${t} has a bit`);
    assert.deepEqual(SHARD_THEMES.slice(0, PICKER_THEMES.length), [...PICKER_THEMES]);
    assert.deepEqual(SHARD_THEMES.slice(0, 6), ["fork", "pin", "hangingPiece", "backRankMate", "mateIn2", "discoveredAttack"]);
    assert.ok(!(MIX_THEME in BITS));
    assert.ok(Object.keys(BITS).every((k) => !k.startsWith("rc:")));
    for (const meta of ["master", "masterVsMaster", "superGM"]) assert.ok(!(meta in BITS));
  });
});

describe("parseRow", () => {
  const idx = headerIndex(HEADER);

  it("keeps a row that passes every filter and scores it Popularity × ln(NbPlays)", () => {
    const row = parseRow(GOOD[0] as string, idx);
    assert.ok(row);
    assert.equal(row.id, "000Pw");
    assert.equal(row.rating, 1514);
    assert.deepEqual(row.themes, ["crushing", "endgame", "fork", "short"]);
    assert.equal(row.score, 92 * Math.log(631));
  });

  it("drops popularity < 80, plays < 300, RD > 90, ratings outside 600-2599, > 15 tokens and bad ids", () => {
    for (const line of REJECTED) assert.equal(parseRow(line, idx), null, line.slice(0, 5));
  });

  it("rejects a header without the needed columns", () => {
    assert.throws(() => headerIndex("PuzzleId,FEN,Moves"), /Rating/);
  });
});

describe("TopK", () => {
  const row = (id: string, score: number): Row => ({ id, fen: "", moves: "", rating: 1500, themes: [], score });

  it("keeps the best rows, ties broken by the smaller id", () => {
    const top = new TopK(3);
    for (const [id, s] of [["a", 1], ["b", 5], ["c", 3], ["d", 5], ["e", 4], ["f", 0]] as const) top.push(row(id, s));
    assert.deepEqual(top.sorted().map((r) => r.id), ["b", "d", "e"]);
    assert.equal(top.size, 3);
  });
});

describe("collect + finish", async () => {
  const { buckets, stats } = await collect(lines([HEADER, ...GOOD, ...REJECTED, ILLEGAL]), 250);
  const { files, manifest } = finish(buckets, { version: "v1", k: 250, built: "2026-11-13", source: "2026-11-01" }, stats);

  it("counts the lines and the rows that pass the filter", () => {
    assert.equal(stats.lines, GOOD.length + REJECTED.length + 1);
    assert.equal(stats.kept, GOOD.length + 1);
  });

  it("drops an illegal line and reports it", () => {
    assert.deepEqual(stats.illegal, ["ZZZZZ"]);
    assert.ok(files.every((f) => f.p.every((t) => t[0] !== "ZZZZZ")));
  });

  it("files each puzzle under every shard theme it carries and under mix, by band", () => {
    const shard = (theme: string, band: number) => files.find((f) => f.theme === theme && f.band === band)?.p.map((t) => t[0]);
    assert.deepEqual(shard("fork", 15), ["003Tx", "000Pw"]);
    assert.deepEqual(shard("fork", 14), ["0017R"]);
    assert.deepEqual(shard("pin", 14), ["003S3", "005Bm"]);
    assert.deepEqual(shard("pin", 15), ["006pe"]);
    assert.deepEqual(shard("mateIn2", 15), ["003Tx", "006pe"]);
    assert.deepEqual(shard(MIX_THEME, 14), ["003S3", "005Bm", "0017R"]);
    assert.equal(shard("skewer", 15), undefined);
  });

  it("writes rating-ascending tuples with the theme mask as a JSON number", () => {
    const fork15 = files.find((f) => f.theme === "fork" && f.band === 15);
    assert.ok(fork15);
    const [id, fen, moves, rating, mask] = fork15.p[1] as (typeof fork15.p)[number];
    assert.deepEqual([id, fen, moves, rating], ["000Pw", FEN0, "e4d2 d4e2 g1f1 e2c3", 1514]);
    assert.ok(Number.isSafeInteger(mask));
    assert.deepEqual(new Set(themesOfMask(mask, BITS)), new Set(["fork", "endgame", "crushing", "short"]));
    const master = files.find((f) => f.theme === "pin" && f.band === 15)?.p[0];
    assert.ok(master && !themesOfMask(master[4], BITS).includes("master"));
  });

  it("builds a manifest whose counts match the files", () => {
    assert.equal(manifest.files, files.length);
    assert.equal(manifest.puzzles, files.reduce((n, f) => n + f.p.length, 0));
    assert.equal(manifest.unique, GOOD.length);
    assert.deepEqual(manifest.themes.fork, { "14": 1, "15": 2 });
    assert.deepEqual(manifest.bits, BITS);
    for (const f of files) assert.deepEqual(checkShard(f, f, manifest), { ok: true });
  });

  it("keeps only the top K per shard", async () => {
    const small = await collect(lines([HEADER, ...GOOD]), 1);
    const built = finish(small.buckets, { version: "v1", k: 1, built: "2026-11-13", source: "2026-11-01" }, small.stats);
    // fork/15: 000Pw (92 × ln 631 ≈ 593) beats 003Tx (83 × ln 772 ≈ 552).
    assert.deepEqual(built.files.find((f) => f.theme === "fork" && f.band === 15)?.p.map((t) => t[0]), ["000Pw"]);
    assert.ok(built.files.every((f) => f.p.length === 1));
  });

  it("round-trips through the files, and verify finds missing, extra and miscounted files", () => {
    const root = path.join(tmp, "build");
    writeBuild(root, files, manifest);
    const dir = path.join(root, "v1");
    assert.deepEqual(readManifest(path.join(dir, "manifest.json")), manifest);
    assert.deepEqual(readShard(path.join(dir, "fork", "15.json")), files.find((f) => f.theme === "fork" && f.band === 15));
    assert.deepEqual(verifyDir(dir, { replay: true }), []);
    assert.equal(PuzzleManifestSchema.safeParse(JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"))).success, true);

    mkdirSync(path.join(dir, "skewer"), { recursive: true });
    writeFileSync(path.join(dir, "skewer", "15.json"), readFileSync(path.join(dir, "fork", "15.json")));
    rmSync(path.join(dir, "pin", "14.json"));
    const errors = verifyDir(dir, { replay: false });
    assert.ok(errors.includes("skewer/15.json: not in the manifest"), errors.join("\n"));
    assert.ok(errors.includes("pin/14.json: missing"), errors.join("\n"));

    const lying = { ...manifest, themes: { ...manifest.themes, fork: { "14": 1, "15": 3 } }, puzzles: manifest.puzzles + 1 };
    assert.ok(verifyDir(dir, { replay: false, manifest: lying }).some((e) => e.startsWith("fork/15: 2 puzzles, manifest says 3")));
  });

  it("serialises the manifest as valid JSON with one line per theme", () => {
    const text = serialiseManifest(manifest);
    assert.deepEqual(JSON.parse(text), manifest);
    assert.match(text, /\n {4}"fork": \{"14": 1, "15": 2\},?\n/);
  });

  it("subsets a build per theme and band, spread over the rating range, with its own manifest", () => {
    const root = path.join(tmp, "full");
    writeBuild(root, files, manifest);
    const sub = subsetOf(path.join(root, "v1"), { themes: ["fork", MIX_THEME], bands: [14], perShard: 2 });
    assert.deepEqual(sub.manifest.themes, { fork: { "14": 1 }, mix: { "14": 2 } });
    assert.deepEqual(sub.files.find((f) => f.theme === MIX_THEME)?.p.map((t) => t[0]), ["003S3", "005Bm"]);
    assert.deepEqual(sub.manifest.bits, manifest.bits);
    assert.throws(() => subsetOf(path.join(root, "v1"), { themes: ["skewer"], bands: [14], perShard: 2 }), /not in the full build/);
  });

  it("marks a shard theme bit on every tuple of that shard", () => {
    for (const f of files) {
      if (f.theme === MIX_THEME) continue;
      for (const t of f.p) assert.ok(maskHas(t[4], f.theme, BITS), `${t[0]} in ${f.theme}`);
    }
  });
});
