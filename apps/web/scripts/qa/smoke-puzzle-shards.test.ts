// smoke-puzzle-shards.ts (phase-05 plan §12.4) against the CI shard server: passes on the committed subset, fails on a
// manifest mismatch, a missing `immutable` header, an illegal line or a bit outside the theme registry.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { startPuzzleShardServer } from "../../e2e/mocks/puzzle-shards";
import { PuzzleManifestSchema } from "../../lib/train/puzzle-shards";
import { registryKeys, runShardSmoke, seeded } from "./smoke-puzzle-shards";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/chess-fixtures/puzzles/shards");
const expected = PuzzleManifestSchema.parse(JSON.parse(readFileSync(path.join(FX, "v1/manifest.json"), "utf8")));
const allKeys = new Set(Object.keys(expected.bits));

describe("puzzle shard smoke", () => {
  let s: Awaited<ReturnType<typeof startPuzzleShardServer>>;
  before(async () => {
    s = await startPuzzleShardServer({ port: 0 });
  });
  after(() => s.close());

  it("passes on the CI subset: manifest, immutable header, 20 legal puzzles from 3 shards", async () => {
    const r = await runShardSmoke({ baseUrl: s.baseUrl, version: "v1", expected, themeKeys: allKeys, random: seeded(1) });
    assert.deepEqual(r.failed, []);
    assert.equal(r.ok, true);
    assert.ok(r.passed.some((l) => /^20 puzzles from 3 shards/.test(l)), r.passed.join("\n"));
    assert.ok(r.passed.some((l) => l.includes("immutable")));
  });

  it("fails when the served manifest is not the committed one", async () => {
    const other = { ...expected, themes: { ...expected.themes, fork: { ...expected.themes.fork, "14": 1 } } };
    const r = await runShardSmoke({ baseUrl: s.baseUrl, version: "v1", expected: other, themeKeys: allKeys, random: seeded(2) });
    assert.equal(r.ok, false);
    assert.ok(r.failed.includes("shard counts differ from the committed manifest"));
  });

  it("fails on a wrong version, a missing manifest or a bit outside the theme registry", async () => {
    const v2 = await runShardSmoke({ baseUrl: s.baseUrl, version: "v2", expected, themeKeys: allKeys });
    assert.deepEqual(v2.failed, ["manifest: HTTP 404"]);
    const few = await runShardSmoke({ baseUrl: s.baseUrl, version: "v1", expected, themeKeys: new Set(["fork"]), random: seeded(3) });
    assert.equal(few.ok, false);
    assert.ok(few.failed.some((l) => l.includes("bits not in the theme registry")));
  });

  it("fails when a shard lacks the immutable header or replays illegally", async () => {
    const tamper: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!String(input).endsWith(".json") || String(input).endsWith("manifest.json")) return res;
      const body = (await res.json()) as { p: [string, string, string, number, string][] };
      for (const t of body.p) t[2] = "a1a8 a1a8";
      return Response.json(body, { headers: { "cache-control": "public, max-age=60" } });
    };
    const r = await runShardSmoke({ baseUrl: s.baseUrl, version: "v1", expected, themeKeys: allKeys, random: seeded(4), fetch: tamper });
    assert.ok(r.failed.some((l) => l.includes("lacks immutable")));
    assert.ok(r.failed.some((l) => /ply 0 illegal a1a8|ply 1 illegal a1a8/.test(l)));
  });

  it("reads the theme registry as a record, a list or a map", () => {
    assert.deepEqual([...registryKeys({ fork: {}, pin: {} })], ["fork", "pin"]);
    assert.deepEqual([...registryKeys([{ key: "fork" }, "pin"])], ["fork", "pin"]);
    assert.deepEqual([...registryKeys(new Map([["fork", 1]]))], ["fork"]);
    assert.throws(() => registryKeys(undefined), /THEMES/);
  });
});
