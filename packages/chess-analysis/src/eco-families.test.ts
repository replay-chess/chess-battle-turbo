// eco-families.ts (phase-06 plan §8.9, §12.1): every one of the 500 codes A00–E99 falls in exactly one family, the
// ranges are ordered and contiguous, names are unique, and the design's samples resolve as the boards show them.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ECO_FAMILIES, ecoFamily, ecoOrdinal, ecoRange, isEcoCode } from "./eco-families";

const ALL_CODES = [..."ABCDE"].flatMap((l) => Array.from({ length: 100 }, (_, n) => `${l}${String(n).padStart(2, "0")}`));

describe("ECO families", () => {
  it("all 500 codes map to exactly one family", () => {
    assert.equal(ALL_CODES.length, 500);
    for (const code of ALL_CODES) {
      // Counted by scanning the table, independently of the lookup index.
      const hits = ECO_FAMILIES.filter((f) => f.from <= code && code <= f.to);
      assert.equal(hits.length, 1, `${code} is in ${hits.length} families`);
      assert.equal(ecoFamily(code), hits[0]);
    }
  });

  it("the ranges are ordered, contiguous and well formed", () => {
    let next = 0;
    for (const f of ECO_FAMILIES) {
      assert.ok(isEcoCode(f.from) && isEcoCode(f.to), `${f.name}: ${f.from}–${f.to}`);
      assert.equal(ecoOrdinal(f.from), next, `${f.name} starts where the previous family ended`);
      assert.ok(ecoOrdinal(f.to) >= ecoOrdinal(f.from));
      next = ecoOrdinal(f.to) + 1;
    }
    assert.equal(next, 500);
  });

  it("names are unique, so a family name identifies one range", () => {
    const names = ECO_FAMILIES.map((f) => f.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(ECO_FAMILIES.length >= 100 && ECO_FAMILIES.length <= 120, `about 110 entries (${ECO_FAMILIES.length})`);
  });

  it("resolves the design's samples", () => {
    const c55 = ecoFamily("C55");
    assert.equal(c55?.name, "Two Knights Defence");
    assert.equal(ecoRange(c55!), "C55–C59");
    assert.equal(ecoFamily("C59")?.name, "Two Knights Defence");
    assert.equal(ecoFamily("D35")?.name, "Queen’s Gambit Declined");
    assert.equal(ecoRange(ecoFamily("D35")!), "D30–D69");
    assert.equal(ecoFamily("B22")?.name, "Sicilian, Alapin");
    assert.equal(ecoRange(ecoFamily("B22")!), "B22");
    assert.equal(ecoFamily("D02")?.name, "London System");
    assert.equal(ecoFamily("B90")?.name, "Sicilian, Najdorf");
    assert.equal(ecoFamily("C47")?.name, "Four Knights Game");
    assert.equal(ecoFamily("A00")?.name, "Uncommon Opening");
    assert.equal(ecoFamily("E99")?.name, "King’s Indian, Classical");
  });

  it("anything that is not a stored ECO code has no family", () => {
    for (const bad of [null, undefined, "", "F00", "c55", "C5", "C555", "A-1", " C55"]) assert.equal(ecoFamily(bad), null);
    assert.throws(() => ecoOrdinal("Z99"), RangeError);
  });
});
