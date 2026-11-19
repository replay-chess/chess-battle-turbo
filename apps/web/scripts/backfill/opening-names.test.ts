// The opening-name repair's pure rule (scripts/backfill/opening-names.ts `repairedOpening`): pre-fix Chess.com slug
// names become the book's name and ECO for the moves, or lose their move tail; names the fixed mapper would store
// are left alone (idempotent). The statements run only against a database (never in this file).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repairedOpening } from "./opening-names";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PRZEPIORKA = "d2d4 g8f6 g1f3 g7g6 g2g3 f8g7 f1g2 d7d6 e1g1 e8g8 c2c3 c7c6 b1d2 b8d7";

describe("repairedOpening", () => {
  it("a slug name with a move tail → the book's name and ECO", () => {
    const row = { openingName: "Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2", ecoCode: "A48", startingFen: START, moves: PRZEPIORKA };
    const fix = repairedOpening(row);
    assert.deepEqual(fix, { openingName: "Indian Defense: Przepiorka Variation", ecoCode: "A49" });
    assert.equal(repairedOpening({ ...row, ...fix! }), null, "a second run changes nothing");
  });

  it("no book line → the name without its tail, ECO kept", () => {
    assert.deepEqual(
      repairedOpening({ openingName: "Pirc Defense Classical Variation...5.Bc4 O-O", ecoCode: "B08", startingFen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", moves: "e2e4" }),
      { openingName: "Pirc Defense Classical Variation", ecoCode: "B08" },
    );
  });

  it("a proper name is left alone", () => {
    assert.equal(repairedOpening({ openingName: "Sicilian Defense: Alapin Variation", ecoCode: "B22", startingFen: START, moves: PRZEPIORKA }), null);
    assert.equal(repairedOpening({ openingName: "Italian Game", ecoCode: "C50", startingFen: START, moves: "e2e4 e7e5" }), null);
  });
});
