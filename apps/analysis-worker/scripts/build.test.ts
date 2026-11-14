// The worker bundle boots (phase-05 WP-C regression: sqids-bundle-interop). The e2e harness runs the worker through
// tsx, so only the image ran the esbuild bundle: a CommonJS interop break of an npm dependency (sqids 0.3.0's
// `exports.default` without the ES-module marker) crashed dist/main.cjs at module load. This builds the bundle into a
// temporary directory inside the package (so its external npm requires resolve as in the image) and starts it with
// an empty environment: it must get as far as the env guard and refuse to boot, never fail while loading modules.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outName = `.build-check-${randomBytes(4).toString("hex")}`;
const outdir = resolve(root, outName);

describe("the esbuild bundle", () => {
  after(() => rmSync(outdir, { recursive: true, force: true }));

  it("builds and loads every module: dist/main.cjs reaches the env guard", () => {
    const build = spawnSync(process.execPath, [resolve(root, "scripts/build.mjs"), "--outdir", outName], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(build.status, 0, build.stderr);
    assert.ok(existsSync(resolve(outdir, "main.cjs")));
    const run = spawnSync(process.execPath, [resolve(outdir, "main.cjs")], {
      cwd: root,
      env: {},
      encoding: "utf8",
      timeout: 30_000,
    });
    const out = `${run.stdout}${run.stderr}`;
    assert.doesNotMatch(out, /TypeError|Cannot find module|is not a constructor/, out);
    assert.match(out, /worker refused to boot/, out);
    assert.match(out, /APP_ENV must be one of/);
  });
});
