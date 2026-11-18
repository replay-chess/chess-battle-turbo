// Pattern slugs (phase-06 plan §4.1, §12.1): every weakness candidate round-trips through its slug, slugs are unique
// and URL-safe, unknown or malformed slugs and non-candidates resolve to null.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PatternSlug } from "@repo/contracts/http/weakness";
import { WEAKNESS_CANDIDATES } from "../themes";
import { patternFromSlug, patternSlug } from "./slug";

describe("pattern slugs", () => {
  it("round-trips every candidate key, with unique, contract-valid slugs", () => {
    const slugs = new Set<string>();
    for (const key of WEAKNESS_CANDIDATES) {
      const slug = patternSlug(key);
      assert.equal(PatternSlug.safeParse(slug).success, true, `${key} → ${slug}`);
      assert.equal(patternFromSlug(slug), key, slug);
      slugs.add(slug);
    }
    assert.equal(slugs.size, WEAKNESS_CANDIDATES.length);
  });

  it("uses kebab-case and drops the rc: prefix", () => {
    assert.equal(patternSlug("fork"), "fork");
    assert.equal(patternSlug("hangingPiece"), "hanging-piece");
    assert.equal(patternSlug("backRankMate"), "back-rank-mate");
    assert.equal(patternSlug("rc:timePressure"), "time-pressure");
    assert.equal(patternSlug("rc:missedThreat"), "missed-threat");
    assert.equal(patternSlug("mateIn2"), "mate-in-2");
    assert.equal(patternFromSlug("time-pressure"), "rc:timePressure");
    assert.equal(patternFromSlug("mate-in-2"), "mateIn2");
  });

  it("resolves unknown, malformed and non-candidate slugs to null", () => {
    for (const bad of ["", "nope", "Fork", "hanging_piece", "hanging--piece", "-fork", "fork-", "mate", "advantage", "middlegame", "remove-the-defender", "capturing-defender", "x".repeat(41)]) {
      assert.equal(patternFromSlug(bad), null, bad);
    }
  });
});
