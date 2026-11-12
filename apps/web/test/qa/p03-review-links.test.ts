// Regression (INTEGRATE-2, phase-03 P3-D29): reopening an ended game showed "Analyse Game" pointing at the legacy
// /analysis page even with review-v3 on, and a live game's end prefetched /analysis. Links out of the game screen
// go through lib/routes.ts reviewHref(ref, reviewV3); the only hard-coded /analysis link left is GameOverCard's
// flag-off branch (and the legacy P0 screen, deleted at H4).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { reviewHref } from "@/lib/routes";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWED = new Set(["features/game/screen/GameOverCard.tsx"]);

test("the game screen builds review links with reviewHref, not a hard-coded /analysis path", () => {
  const files = readdirSync(path.join(WEB, "features/game"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.includes(".test."))
    .map((e) => path.relative(WEB, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .filter((f) => !f.startsWith("features/game/legacy/") && !ALLOWED.has(f));
  const offenders = files.filter((f) => /["'`]\/analysis\//.test(readFileSync(path.join(WEB, f), "utf8")));
  assert.deepEqual(offenders, []);
  for (const f of ["features/game/screen/zones/Zones.tsx", "features/game/live/useLiveGame.ts"]) {
    assert.match(readFileSync(path.join(WEB, f), "utf8"), /reviewHref\(/, f);
  }
});

test("reviewHref: the review with review-v3, the legacy page without", () => {
  assert.equal(reviewHref("cabc", true), "/review/cabc");
  assert.equal(reviewHref("cabc", false), "/analysis/cabc");
});
