// The dev seed entry (phase-03 plan §6.9 "DB/seed/review.ts, called from the dev seed entry"). Checked on the source:
// running the entry needs a fresh database (it creates fixed rows), which the review seed's integration test covers.
// regression: review-seed-not-in-dev-seed (FIX-1): `pnpm --filter @repo/db seed` gave a fresh dev database no P3
// fixtures unless `seed:review` also ran.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("./seed.ts", import.meta.url)), "utf8");

describe("dev seed entry", () => {
  it("runs the review seed through its own write-target guard and tripwire, after the base rows", () => {
    assert.match(src, /import \{ DEFAULT_MEMBER_EMAIL, runReviewSeed \} from '\.\.\/seed\/review';/);
    assert.match(src, /resolveWriteTarget\(\)/);
    assert.match(src, /await checkTripwire\(db\);\s*const r = await runReviewSeed\(db, \{ apply: true/);
    const main = src.slice(src.indexOf("async function main()"), src.indexOf("async function seedReviewFixtures"));
    assert.ok(main.lastIndexOf("await seedReviewFixtures();") > main.lastIndexOf("chessPosition.create"), "after the base rows");
  });

  it("a missing precondition skips only the review fixtures; any other error still fails the seed", () => {
    const handler = src.slice(src.indexOf("} catch (err) {", src.indexOf("async function seedReviewFixtures")));
    assert.match(handler, /^\} catch \(err\) \{\s*if \(err instanceof SeedGuardError\) \{/);
    assert.match(handler, /Review fixtures skipped/);
    assert.match(handler, /return;\s*\}\s*throw err;/);
  });
});
