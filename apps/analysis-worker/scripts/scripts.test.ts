// The owner-run scripts of tasks C1 and C4: the seed builder (EPD targets from the openings lines, the chess.js EPD
// normalisation, the deepest-with-two-lines choice, White-POV encoding, plain and zstd input, a file the worker's
// cache merges as is), the R2 upload (dry run by default, validation, the PutObject it sends, missing credentials
// named but never printed) and the bench's argument and output parsing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { describe, it } from "node:test";
import type { PutObjectCommand } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { encodeCp, encodeMate, NO_SECOND } from "@repo/chess-analysis/codec";
import { EvalCache } from "../src/cache/evalcache";
import { SEED_ENGINE, SEED_NAME } from "../src/cache/schema";
import { silentLogger } from "../src/obs/log";
import { Metrics } from "../src/obs/metrics";
import { parseArgs as benchArgs, parseBenchOutput, sampleUci } from "./bench";
import { buildSeed, normaliseEpd, openingEpds, parseArgs as seedArgs, rowFor } from "./seed-evalcache";
import { parseArgs as uploadArgs, upload, validateSeedFile } from "./upload-evalcache-seed";

const START_EPD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -";

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "wk-seed-"));
  const openings = join(dir, "openings");
  mkdirSync(openings);
  writeFileSync(join(openings, "c.tsv"), "eco\tname\tpgn\nC20\tKing's Pawn Game\t1. e4 e5\n");
  const lines = [
    { fen: START_EPD, evals: [{ pvs: [{ cp: 18, line: "e2e4 e7e5" }, { cp: 12, line: "d2d4 d7d5" }], knodes: 500000, depth: 46 }] },
    // Two evaluations: the deeper one with two lines wins; a one-line one is deeper but loses to two lines.
    {
      fen: AFTER_E4,
      evals: [
        { pvs: [{ cp: 30, line: "c7c5" }], knodes: 900000, depth: 50 },
        { pvs: [{ cp: 25, line: "e7e5 g1f3" }, { cp: 33, line: "c7c5" }], knodes: 300000, depth: 40 },
        { pvs: [{ cp: 20, line: "e7e5" }, { cp: 34, line: "c7c5" }], knodes: 200000, depth: 38 },
      ],
    },
    // Too shallow.
    { fen: AFTER_E4_E5, evals: [{ pvs: [{ cp: 40, line: "g1f3" }, { cp: 30, line: "f1c4" }], knodes: 50, depth: 20 }] },
    // Not on an opening line.
    { fen: "8/8/8/8/8/8/k7/7K w - -", evals: [{ pvs: [{ cp: 0, line: "h1g1" }], knodes: 5000, depth: 60 }] },
  ];
  const jsonl = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(dir, "evals.jsonl"), jsonl);
  writeFileSync(join(dir, "evals.jsonl.zst"), zstdCompressSync(Buffer.from(jsonl)));
  return { dir, openings };
}

describe("seed-evalcache", () => {
  it("collects the EPDs along the opening lines plus the initial position", () => {
    const { openings } = fixtureDir();
    assert.deepEqual([...openingEpds(openings)].sort(), [START_EPD, AFTER_E4, AFTER_E4_E5].sort());
  });

  it("normalises a Lichess FEN to the worker's EPD (chess.js drops an en-passant square no pawn can take)", () => {
    assert.equal(normaliseEpd("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"), AFTER_E4);
    assert.equal(normaliseEpd("not a fen"), null);
  });

  it("keeps the deepest two-line evaluation, White POV, and handles mates", () => {
    const row = rowFor(AFTER_E4, [
      { pvs: [{ cp: 30, line: "c7c5" }], knodes: 900000, depth: 50 },
      { pvs: [{ mate: -3, line: "e7e5" }, { cp: 33, line: "c7c5" }], knodes: 300000, depth: 40 },
    ], 120);
    assert.ok(row);
    assert.equal(row.engine, SEED_ENGINE);
    assert.equal(row.nodes, 300_000_000);
    assert.equal(row.multipv, 2);
    assert.equal(row.eval, encodeMate("b", 3));
    assert.equal(row.second, encodeCp(33));
    assert.equal(row.best, "e7e5");
    assert.equal(rowFor(AFTER_E4, [{ pvs: [{ cp: 1, line: "a7a6" }], knodes: 100, depth: 9 }], 120), null, "under 120 knodes");
    const single = rowFor(AFTER_E4, [{ pvs: [{ cp: 1, line: "a7a6" }], knodes: 500, depth: 9 }], 120);
    assert.equal(single?.multipv, 1);
    assert.equal(single?.second, NO_SECOND);
  });

  for (const input of ["evals.jsonl", "evals.jsonl.zst"]) {
    it(`builds a seed file the worker's cache merges (${input})`, async () => {
      const { dir, openings } = fixtureDir();
      const out = join(dir, `${SEED_NAME}.sqlite`);
      const report = await buildSeed(seedArgs(["--input", join(dir, input), "--out", out, "--openings", openings]), () => undefined);
      assert.deepEqual(report, { linesRead: 4, candidates: 3, written: 2, targetEpds: 3 });
      await assert.rejects(buildSeed(seedArgs(["--input", join(dir, input), "--out", out, "--openings", openings]), () => undefined), /exists/);
      const db = new Database(out, { readonly: true });
      const rows = db.prepare("SELECT epd, nodes, multipv, eval, second, best FROM evals ORDER BY epd").all();
      assert.deepEqual(rows, [
        { epd: AFTER_E4, nodes: 300_000_000, multipv: 2, eval: 25, second: 33, best: "e7e5" },
        { epd: START_EPD, nodes: 500_000_000, multipv: 2, eval: 18, second: 12, best: "e2e4" },
      ]);
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'name'").pluck().get(), SEED_NAME);
      db.close();

      const metrics = new Metrics({ workerId: "w", bootId: "00000001", version: "0", profile: "sf18-v1" }, 0);
      const cache = EvalCache.open({ path: join(dir, "cache.sqlite"), log: silentLogger, metrics, nowMs: () => 0 });
      assert.deepEqual(cache.mergeSeed(out), { name: SEED_NAME, inserted: 2 });
      const hit = cache.get({ epd: AFTER_E4, engine: "sf18-armv8dp-c288c895", nodes: 120_000, multipv: 2 }, { allowSeed: true });
      assert.equal(hit?.eval, 25);
      assert.deepEqual(hit?.lines?.[0], { eval: 25, pv: ["e7e5", "g1f3"] });
      cache.close();
    });
  }

  it("refuses incomplete arguments", () => {
    assert.throws(() => seedArgs(["--input", "x"]), /usage/);
    assert.throws(() => seedArgs(["--input", "x", "--out", "y", "--min-knodes", "0"]), /min-knodes/);
    assert.throws(() => seedArgs(["--bogus"]), /unknown argument/);
  });
});

describe("upload-evalcache-seed", () => {
  async function seed() {
    const { dir, openings } = fixtureDir();
    const out = join(dir, `${SEED_NAME}.sqlite`);
    await buildSeed(seedArgs(["--input", join(dir, "evals.jsonl"), "--out", out, "--openings", openings]), () => undefined);
    return { dir, out };
  }

  it("dry-runs by default: validates and plans, no network", async () => {
    const { out } = await seed();
    const plan = await upload(uploadArgs(["--file", out]), {});
    assert.equal(plan.uploaded, false);
    assert.equal(plan.key, "evalcache/evalcache-seed-v1.sqlite");
    assert.equal(plan.publicUrl, "https://media.playchess.tech/evalcache/evalcache-seed-v1.sqlite");
    assert.equal(plan.rows, 2);
    assert.match(plan.sha256, /^[0-9a-f]{64}$/);
  });

  it("with --yes: refuses missing credentials by name only, and sends one immutable PutObject", async () => {
    const { out } = await seed();
    await assert.rejects(upload(uploadArgs(["--file", out, "--yes"]), { R2_ACCOUNT_ID: "acc", R2_SECRET_ACCESS_KEY: "s3cr3t" }), (e: Error) => {
      assert.match(e.message, /missing R2_ACCESS_KEY_ID, R2_BUCKET/);
      assert.doesNotMatch(e.message, /s3cr3t/);
      return true;
    });
    const sent: PutObjectCommand[] = [];
    const plan = await upload(
      uploadArgs(["--file", out, "--yes", "--public-base", "https://cdn.example/"]),
      { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "s3cr3t", R2_BUCKET: "replay-chess-media" },
      { send: async (c) => void sent.push(c) },
    );
    assert.equal(plan.uploaded, true);
    assert.equal(plan.publicUrl, "https://cdn.example/evalcache/evalcache-seed-v1.sqlite");
    assert.equal(sent.length, 1);
    const input = sent[0]!.input;
    assert.equal(input.Bucket, "replay-chess-media");
    assert.equal(input.Key, "evalcache/evalcache-seed-v1.sqlite");
    assert.equal(input.CacheControl, "public, max-age=31536000, immutable");
    assert.equal(input.Metadata?.sha256, plan.sha256);
  });

  it("refuses a file that is not a seed", async () => {
    const { dir } = await seed();
    const bad = join(dir, "bad.sqlite");
    const db = new Database(bad);
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('format', '1'); CREATE TABLE evals (engine TEXT);");
    db.close();
    assert.throws(() => validateSeedFile(bad), /no seed name/);
  });
});

describe("bench", () => {
  it("the sample is 60 legal plies", () => {
    const uci = sampleUci();
    assert.equal(uci.length, 60);
    assert.equal(uci[0], "d2d4");
  });

  it("parses `stockfish bench` and its arguments", () => {
    const text = "===========================\nTotal time (ms) : 1089\nNodes searched  : 2050811\nNodes/second    : 1883205\n";
    assert.deepEqual(parseBenchOutput(text), { ms: 1089, nodes: 2050811, nps: 1883205 });
    assert.throws(() => parseBenchOutput("nothing"), /Total time/);
    assert.deepEqual(benchArgs(["--compare", "80000", "--out", "b.json"], { ENGINE_PATH: "/sf" }), {
      engine: "/sf",
      pass1Nodes: 120_000,
      compare: 80_000,
      out: "b.json",
      skipBench: false,
    });
    assert.throws(() => benchArgs(["--pass1-nodes", "0"], {}), /positive/);
  });
});
