import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { filterDrift, parseProtectedIndexes, sqlStatements } from "./drift";

const PROTECTED = parseProtectedIndexes(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prisma/protected-indexes.txt"), "utf8"),
);

describe("check-drift filter (plan 6.3)", () => {
  it("protected-indexes.txt lists the four M2 partial indexes", () => {
    for (const name of ["games_open_idx", "games_white_player_idx", "games_black_player_idx", "games_rematch_of_idx"]) {
      assert.ok(PROTECTED.has(name), name);
    }
  });

  it("an empty migration is no drift", () => {
    assert.deepEqual(filterDrift("-- This is an empty migration.\n", PROTECTED).drift, []);
  });

  it("ignores DROP INDEX of protected names and storage parameters", () => {
    const script = `-- DropIndex
DROP INDEX "games_open_idx";

-- DropIndex
DROP INDEX "public"."games_white_player_idx";
ALTER TABLE "games" SET (fillfactor = 100);
ALTER TABLE games ALTER COLUMN moves SET COMPRESSION pglz;
`;
    const report = filterDrift(script, PROTECTED);
    assert.deepEqual(report.drift, []);
    assert.equal(report.ignored.length, 4);
  });

  it("fails on anything else, including a DROP INDEX of an unprotected name", () => {
    const script = `DROP INDEX "games_status_idx";
-- AlterTable
ALTER TABLE "games" ADD COLUMN "foo" TEXT;
CREATE INDEX "x" ON "games"("foo");`;
    const report = filterDrift(script, PROTECTED);
    assert.deepEqual(report.drift, [
      'DROP INDEX "games_status_idx"',
      'ALTER TABLE "games" ADD COLUMN "foo" TEXT',
      'CREATE INDEX "x" ON "games"("foo")',
    ]);
  });

  it("splits statements and strips comments", () => {
    assert.deepEqual(sqlStatements("-- a\nSELECT 1; -- b\n\nSELECT 2;"), ["SELECT 1", "SELECT 2"]);
  });
});
