// The CI puzzle shard subset (puzzles/shards/v1; phase-05 plan §9.3, §12.3): every file the manifest lists exists with
// that count and nothing else does, every tuple sits in its band with its theme bit, ids are unique per shard and in
// rating order, every solution (setup move + line) replays legally with chess.js, and the subset was cut from the
// committed full manifest (@repo/chess-training/puzzles/manifest.v1.json: same version, same bits, no larger counts).
// Self-contained on purpose (the format lives in apps/web/lib/train/puzzle-shards.ts; this package has no deps).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "puzzles", "shards", "v1");
const FULL = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "chess-training", "puzzles", "manifest.v1.json");

type Tuple = [string, string, string, number, number];
type Manifest = {
  version: string;
  format: number;
  k: number;
  themes: Record<string, Record<string, number>>;
  bits: Record<string, number>;
  files: number;
  puzzles: number;
  unique: number;
};
type Shard = { v: number; version: string; theme: string; band: number; p: Tuple[] };

const manifest = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as Manifest;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

test("the subset is 6 themes × 7 bands (fork, pin, hangingPiece, backRankMate, mateIn2, mix × 12-18)", () => {
  assert.equal(manifest.version, "v1");
  assert.equal(manifest.format, 1);
  assert.deepEqual(Object.keys(manifest.themes), ["fork", "pin", "hangingPiece", "backRankMate", "mateIn2", "mix"]);
  for (const bands of Object.values(manifest.themes)) assert.deepEqual(Object.keys(bands), ["12", "13", "14", "15", "16", "17", "18"]);
  assert.equal(manifest.files, 42);
});

test("files on disk are exactly the manifest's, with its counts", () => {
  const listed = Object.entries(manifest.themes).flatMap(([t, bands]) => Object.keys(bands).map((b) => `${t}/${b}.json`));
  const onDisk = readdirSync(ROOT)
    .filter((d) => statSync(path.join(ROOT, d)).isDirectory())
    .flatMap((d) => readdirSync(path.join(ROOT, d)).map((f) => `${d}/${f}`));
  assert.deepEqual(onDisk.sort(), listed.sort());
  let puzzles = 0;
  const ids = new Set<string>();
  for (const rel of listed) {
    const shard = JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")) as Shard;
    const [theme, band] = rel.replace(".json", "").split("/") as [string, string];
    assert.equal(shard.p.length, manifest.themes[theme]?.[band], rel);
    puzzles += shard.p.length;
    for (const t of shard.p) ids.add(t[0]);
  }
  assert.equal(puzzles, manifest.puzzles);
  assert.equal(ids.size, manifest.unique);
});

test("the subset was cut from the committed full manifest", () => {
  assert.ok(existsSync(FULL), "packages/chess-training/puzzles/manifest.v1.json is committed");
  const full = JSON.parse(readFileSync(FULL, "utf8")) as Manifest;
  assert.equal(full.version, manifest.version);
  assert.deepEqual(full.bits, manifest.bits);
  for (const [theme, bands] of Object.entries(manifest.themes)) {
    for (const [band, n] of Object.entries(bands)) assert.ok(n <= (full.themes[theme]?.[band] ?? 0), `${theme}/${band}`);
  }
});

for (const [theme, bands] of Object.entries(manifest.themes)) {
  for (const band of Object.keys(bands)) {
    test(`${theme}/${band}: header, band, theme bit, order and legal solutions`, () => {
      const shard = JSON.parse(readFileSync(path.join(ROOT, theme, `${band}.json`), "utf8")) as Shard;
      assert.deepEqual([shard.v, shard.version, shard.theme, shard.band], [1, "v1", theme, Number(band)]);
      const seen = new Set<string>();
      let last = 0;
      for (const [id, fen, moves, rating, mask] of shard.p) {
        assert.match(id, /^[A-Za-z0-9]{5,8}$/);
        assert.ok(!seen.has(id), `duplicate ${id}`);
        seen.add(id);
        assert.equal(Math.floor(rating / 100), Number(band), `${id} rating ${rating}`);
        assert.ok(rating >= last, `${id} breaks the rating order`);
        last = rating;
        // The theme mask is a JSON number over the manifest's bits (≤ 53, exact): no bit outside the table.
        assert.ok(Number.isSafeInteger(mask) && mask >= 0, `${id} mask ${mask}`);
        const bitSet = (bit: number) => Math.floor(mask / 2 ** bit) % 2 === 1;
        const named = Object.values(manifest.bits).reduce((sum, bit) => sum + (bitSet(bit) ? 2 ** bit : 0), 0);
        assert.equal(named, mask, `${id} sets a bit the manifest does not name`);
        if (theme !== "mix") assert.ok(bitSet(manifest.bits[theme] as number), `${id} lacks the ${theme} bit`);
        const tokens = moves.split(" ");
        assert.ok(tokens.length >= 2 && tokens.length <= 15, `${id} has ${tokens.length} moves`);
        const chess = new Chess(fen);
        for (const uci of tokens) {
          assert.match(uci, UCI);
          assert.doesNotThrow(
            () => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }),
            `${id}: ${uci} is illegal in ${chess.fen()}`,
          );
        }
      }
    });
  }
}
