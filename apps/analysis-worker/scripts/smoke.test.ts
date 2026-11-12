// The post-deploy smoke's pure parts (phase-03 plan §12.8): argument parsing, the pass/fail rule, and the smoke game
// reference staying equal to what DB/seed/smoke.ts seeds (a drift guard read from the seed's source, because
// @repo/db does not export its seeds).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { smokeFailures, SMOKE_GAME_REF, type SmokeState } from "../src/smoke";
import { parseSmokeArgs } from "./smoke";

const DB = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db");

const good: SmokeState = {
  analysisStatus: "DONE",
  plyCount: 26,
  gradedPlies: 26,
  judgements: new Array<number>(26).fill(3),
  readyMs: null,
  reviews: 1,
  jobStatus: "DONE",
  lastError: null,
};

describe("smoke", () => {
  it("parses --ref and refuses anything else", () => {
    assert.deepEqual(parseSmokeArgs([]), { ref: SMOKE_GAME_REF });
    assert.deepEqual(parseSmokeArgs(["--ref", "cabc12345678"]), { ref: "cabc12345678" });
    assert.throws(() => parseSmokeArgs(["--ref"]));
    assert.throws(() => parseSmokeArgs(["--ref", "x; rm"]));
    assert.throws(() => parseSmokeArgs(["--yes"]));
  });

  it("passes only DONE, every ply graded, a review, readyMs null", () => {
    assert.deepEqual(smokeFailures(good), []);
    assert.equal(smokeFailures({ ...good, analysisStatus: "FAILED" }).length, 1);
    assert.equal(smokeFailures({ ...good, gradedPlies: 20 }).length, 1);
    assert.equal(smokeFailures({ ...good, judgements: [...good.judgements.slice(1), 0] }).length, 1);
    assert.equal(smokeFailures({ ...good, reviews: 0 }).length, 1);
    assert.equal(smokeFailures({ ...good, readyMs: 1200 }).length, 1);
  });

  it("uses the seeded smoke game's reference (DB/seed/smoke.ts)", () => {
    const smoke = readFileSync(resolve(DB, "seed/smoke.ts"), "utf8");
    const builders = readFileSync(resolve(DB, "seed/builders.ts"), "utf8");
    const key = /SMOKE_GAME_KEY = "([^"]+)"/.exec(smoke)?.[1];
    const scope = /SMOKE_SCOPE = "([^"]+)"/.exec(smoke)?.[1];
    assert.ok(key && scope);
    assert.match(smoke, /SMOKE_GAME_REF = seededRef\(SMOKE_GAME_KEY, SMOKE_SCOPE\)/);
    assert.match(
      builders,
      /return `c\$\{sha256\(`p3-seed:\$\{key\}:\$\{scope\}`\)\.toString\("hex"\)\.slice\(0, 24\)\}`;/,
    );
    const ref = `c${createHash("sha256").update(`p3-seed:${key}:${scope}`).digest("hex").slice(0, 24)}`;
    assert.equal(SMOKE_GAME_REF, ref);
  });
});
