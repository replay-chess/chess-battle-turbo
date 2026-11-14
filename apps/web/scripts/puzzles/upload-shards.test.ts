// upload-shards.ts (phase-05 plan §8.13): the upload plan maps every manifest shard to `puzzles/<version>/…` and puts
// the manifest last, so a half-finished upload never advertises a version. No test reaches R2.
import { strict as assert } from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manifestShards } from "../../lib/train/puzzle-shards";
import { readManifest } from "./build-shards";
import { R2_PREFIX, SHARD_CACHE_CONTROL, uploadPlan } from "./upload-shards";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/chess-fixtures/puzzles/shards");

describe("uploadPlan", () => {
  it("lists every shard under puzzles/<version>/ and the manifest last", () => {
    const manifest = readManifest(path.join(FX, "v1/manifest.json"));
    const plan = uploadPlan(FX, "v1");
    assert.equal(plan.length, manifest.files + 1);
    assert.deepEqual(plan.at(-1), { key: `${R2_PREFIX}/v1/manifest.json`, file: path.join(FX, "v1/manifest.json") });
    assert.deepEqual(
      plan.slice(0, -1).map((i) => i.key),
      manifestShards(manifest).map((s) => `puzzles/v1/${s.theme}/${s.band}.json`),
    );
    assert.ok(plan.every((i) => i.file.startsWith(FX)));
  });

  it("refuses a version the manifest does not describe", () => {
    assert.throws(() => uploadPlan(FX, "v2"), /ENOENT|no such file/);
  });

  it("uploads with the immutable cache header", () => {
    assert.equal(SHARD_CACHE_CONTROL, "public, max-age=31536000, immutable");
  });
});
