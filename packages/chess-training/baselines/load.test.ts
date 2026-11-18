// The baseline schema and loader (phase-06 plan §7.4.5 step 8, signatures.md §3): the committed synthetic file parses,
// equals what its generator produces (so it cannot drift), carries the worker's engine profile, has every 100-point
// cell from 600 to 2400 with ≥ 20 000 moves, falls monotonically in blunder rate with rating, keeps the fork rate of
// the 1100 blitz cell inside the sanity bounds, and the strict validator refuses malformed documents.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { syntheticBaselineJson } from "../scripts/synthetic-baseline";
import { WEAKNESS_CANDIDATES } from "../src/themes";
import { assertBaselineProfile, baselineIds, DEFAULT_BASELINE_ID, isSyntheticBaseline, loadBaseline } from "./load";
import { BASELINE_TIME_CLASSES, BaselineError, bandKeys, parseBaseline } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));

describe("baselines", () => {
  it("the committed v0-synthetic.json is exactly what scripts/synthetic-baseline.ts generates", () => {
    assert.equal(readFileSync(resolve(here, "v0-synthetic.json"), "utf8"), syntheticBaselineJson());
  });

  it("loads the default baseline once, with the worker's engine profile", () => {
    assert.ok(baselineIds().includes(DEFAULT_BASELINE_ID));
    const b = loadBaseline();
    assert.equal(loadBaseline(), b, "memoised per process");
    assert.equal(b.profile, ENGINE_PROFILE.id);
    assert.doesNotThrow(() => assertBaselineProfile(b, ENGINE_PROFILE.id));
    assert.throws(() => assertBaselineProfile(b, "sf17-v9"), /baseline_profile_mismatch/);
    assert.equal(isSyntheticBaseline(loadBaseline("v0-synthetic")), true);
    assert.throws(() => loadBaseline("v9"), /unknown baseline/);
  });

  it("has every cell 600–2400 × {BULLET, BLITZ, RAPID} with ≥ 20 000 moves and every candidate theme but time pressure", () => {
    const b = loadBaseline("v0-synthetic");
    assert.deepEqual(bandKeys(b), Array.from({ length: 19 }, (_, i) => String(600 + i * 100)));
    for (const band of bandKeys(b)) {
      for (const tc of BASELINE_TIME_CLASSES) {
        const c = b.bands[band]![tc];
        assert.ok(c.moves >= 20_000, `${band} ${tc}`);
        assert.equal(c.clockMoves.reduce((s, x) => s + x, 0), c.moves, `${band} ${tc} clock moves`);
        assert.equal(c.timePressure.per100Lt1, c.clockBlunders100[3], "one computation for the lt1 bar and the row (C4)");
        for (const key of WEAKNESS_CANDIDATES.filter((k) => k !== "rc:timePressure")) assert.ok(key in c.themes, `${band} ${tc} ${key}`);
      }
    }
  });

  it("blunder rates are non-increasing with the band (soft check: ≤ 20 % of adjacent pairs may invert)", () => {
    const b = loadBaseline("v0-synthetic");
    const keys = bandKeys(b);
    let pairs = 0;
    let inverted = 0;
    for (const tc of BASELINE_TIME_CLASSES) {
      for (let i = 1; i < keys.length; i++) {
        const lo = b.bands[keys[i - 1]!]![tc];
        const hi = b.bands[keys[i]!]![tc];
        for (let k = 0; k < 4; k++) {
          pairs += 1;
          if (hi.clockBlunders100[k]! > lo.clockBlunders100[k]!) inverted += 1;
        }
      }
    }
    assert.ok(inverted / pairs <= 0.2, `${inverted} of ${pairs} pairs invert`);
  });

  it("the fork rate of the 1100 blitz cell is within the sanity bounds (0.5–4.0 per 100)", () => {
    const fork = loadBaseline("v0-synthetic").bands["1100"]!.BLITZ.themes.fork!.per100;
    assert.ok(fork >= 0.5 && fork <= 4.0, String(fork));
  });

  it("the strict validator names the bad path", () => {
    const raw = JSON.parse(syntheticBaselineJson()) as Record<string, unknown>;
    assert.equal(parseBaseline(raw).id, "v0-synthetic");
    /** A copy of the generated document with the value at `path` replaced (undefined = deleted). */
    const bad = (path: string[], value: unknown) => {
      const o = JSON.parse(syntheticBaselineJson()) as Record<string, unknown>;
      let node = o;
      for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
      const last = path[path.length - 1]!;
      if (value === undefined) delete node[last];
      else node[last] = value;
      return () => parseBaseline(o);
    };
    const cell1100 = (JSON.parse(syntheticBaselineJson()) as { bands: Record<string, unknown> }).bands["1100"];
    assert.throws(bad(["v"], 2), (e: unknown) => e instanceof BaselineError && e.path === "$.v");
    assert.throws(bad(["extra"], 1), /\$\.extra: unknown key/);
    assert.throws(bad(["bands", "1100", "RAPID"], undefined), /\$\.bands\.1100\.RAPID: missing/);
    assert.throws(bad(["bands", "1100", "BLITZ", "phaseAccuracy"], [80, 70]), /phaseAccuracy: expected 3 numbers/);
    assert.throws(bad(["bands", "1150"], cell1100), /lower edge of a 100-point cell/);
    assert.throws(bad(["bands", "1100", "BLITZ", "themes", "rc:timePressure"], { per100: 1, loss100: 1 }), /not a theme candidate key/);
    assert.throws(bad(["bands", "1100", "BLITZ", "conversion"], 1.2), /conversion: above 1/);
    assert.throws(bad(["calibration", "1100", "ALL"], 0), /calibration\.1100\.ALL: below 0\.1/);
    assert.throws(bad(["bands"], {}), /\$\.bands: no band/);
  });
});
