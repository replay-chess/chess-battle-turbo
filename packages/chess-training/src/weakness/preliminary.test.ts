// Preliminary patterns (phase-06 plan §8.10, §12.1): 4 analysed → []; 14 analysed → "Seen in 5 of 14 games";
// at most 3; seen in at least 2 games; none from 20 analysed (the full profile takes over).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { err, gameInput } from "../../test/gen";
import { aggregate } from "./aggregate";
import { analysedOf } from "./compute";
import { preliminaryPatterns } from "./preliminary";

const at = new Date("2026-11-10T12:00:00Z");

function games(n: number, themesOf: (i: number) => string[][]) {
  return analysedOf(Array.from({ length: n }, (_, i) => gameInput({ gameId: String(1 + i), color: "w", endedAt: at, errors: themesOf(i).map((t) => err(t)) })));
}

describe("preliminary patterns", () => {
  it("is empty below 5 analysed games and from 20", () => {
    const four = games(4, () => [["fork"]]);
    assert.deepEqual(preliminaryPatterns(aggregate(four), 4), []);
    const twenty = games(20, () => [["fork"]]);
    assert.deepEqual(preliminaryPatterns(aggregate(twenty), 20), []);
  });

  it("14 analysed: by games then events, ≥ 2 games, top 3", () => {
    const g = games(14, (i) => [
      ...(i < 5 ? [["fork"], ["fork"]] : []),
      ...(i >= 5 && i < 8 ? [["hangingPiece"]] : []),
      ...(i >= 8 && i < 11 ? [["pin"], ["pin"]] : []),
      ...(i === 12 ? [["skewer"], ["skewer"], ["skewer"]] : []),
      ...(i === 13 ? [["advantage"], ["mate"]] : []),
    ]);
    const rows = preliminaryPatterns(aggregate(g), 14);
    assert.deepEqual(rows, [
      { pattern: "fork", label: "Missed forks", seenIn: 5, of: 14 },
      { pattern: "pin", label: "Missed pins", seenIn: 3, of: 14 },
      { pattern: "hangingPiece", label: "Missed free pieces", seenIn: 3, of: 14 },
    ]);
  });
});
