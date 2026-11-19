// The shared opening-name rule (src/opening-name.ts) and its book data (src/opening-book.data.ts): the committed data
// is what scripts/build-opening-book.ts makes from the `openings` seed TSVs; a game is named by the longest book line
// that prefixes its moves; a provider name keeps its words and case without the move tail.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { bookEntriesOf, readOpeningTsvs } from "../../scripts/build-opening-book";
import { OPENING_BOOK } from "../opening-book.data";
import { bookOpeningOf, openingOfGame, stripMoveTail } from "../opening-name";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("opening book data", () => {
  it("is the seed TSVs replayed (re-run scripts/build-opening-book.ts when they change)", () => {
    const { entries, failures } = bookEntriesOf(readOpeningTsvs());
    assert.deepEqual(failures, []);
    assert.equal(entries.length, 3641);
    assert.deepEqual(OPENING_BOOK, entries);
  });

  it("no book name carries a move number, \"...\" or castling", () => {
    for (const [, name] of OPENING_BOOK) {
      assert.doesNotMatch(name, /\b\d+\.(\.\.)?|\.\.\.|O-O/, name);
      assert.equal(stripMoveTail(name), name, `stripMoveTail keeps the book name ${name}`);
    }
  });
});

describe("bookOpeningOf", () => {
  it("the longest book line that prefixes the moves, with its ECO", () => {
    assert.deepEqual(bookOpeningOf(START, "e2e4 e7e5 g1f3 b8c6 f1c4"), { eco: "C50", name: "Italian Game" });
    assert.deepEqual(bookOpeningOf(START, ["d2d4", "g8f6", "g1f3", "g7g6", "g2g3", "f8g7"]), {
      eco: "A49",
      name: "Indian Defense: Przepiorka Variation",
    });
    // a cut last token (the archive reads a bounded head of the moves) never matches a longer line
    assert.deepEqual(bookOpeningOf(START, "e2e4 e7e5 g1f3 b8c6 f1c"), bookOpeningOf(START, "e2e4 e7e5 g1f3 b8c6"));
  });

  it("nothing for a non-standard start or no moves", () => {
    assert.equal(bookOpeningOf("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e2e4"), null);
    assert.equal(bookOpeningOf(START, ""), null);
  });
});

describe("stripMoveTail", () => {
  it("cuts at the first move-number token and drops trailing punctuation; case is kept", () => {
    const cases: [string, string | null][] = [
      ["Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2", "Indian Game East Indian Przepiorka Variation"],
      ["Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4", "Queens Indian Defense Spassky System"],
      ["Closed Sicilian Defense 2...e6 3.g3 a6 4.Bg2", "Closed Sicilian Defense"],
      ["Pirc Defense 2.d4", "Pirc Defense"],
      ["Sicilian Defense Najdorf Variation English Attack Anti English...8.f3 h5 9.Qd2", "Sicilian Defense Najdorf Variation English Attack Anti English"],
      ["Indian Game East Indian Przepiorka Variation...5.O-O-O O 6.c3", "Indian Game East Indian Przepiorka Variation"],
      ["Scandinavian Defense Mieses Kotroc Variation", "Scandinavian Defense Mieses Kotroc Variation"],
      ["Sicilian Defense: O'Kelly Variation", "Sicilian Defense: O'Kelly Variation"],
      ["1.e4", null],
    ];
    for (const [input, out] of cases) assert.equal(stripMoveTail(input), out, input);
    assert.equal(stripMoveTail(null), null);
  });
});

describe("openingOfGame", () => {
  const przepiorka = "d2d4 g8f6 g1f3 g7g6 g2g3 f8g7 f1g2 d7d6 e1g1 e8g8 c2c3 c7c6 b1d2 b8d7";

  it("a slug name is replaced by the book's line for the moves, ECO included", () => {
    assert.deepEqual(
      openingOfGame({ name: "Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3", eco: "A48", startingFen: START, moves: przepiorka }),
      { eco: "A49", name: "Indian Defense: Przepiorka Variation" },
    );
    assert.deepEqual(openingOfGame({ name: null, eco: null, startingFen: START, moves: "e2e4 e7e5 g1f3 b8c6 f1c4" }), {
      eco: "C50",
      name: "Italian Game",
    });
  });

  it("a proper name stands: a book name (whole or as stored at 80 chars) or a \"Family: Variation\" name", () => {
    assert.deepEqual(openingOfGame({ name: "Italian Game", eco: "C50", startingFen: START, moves: przepiorka }), { eco: "C50", name: "Italian Game" });
    const long = OPENING_BOOK.find(([, n]) => n.length > 80)![1];
    assert.equal(openingOfGame({ name: long.slice(0, 80), eco: "A29", startingFen: START, moves: przepiorka })?.name, long.slice(0, 80));
    assert.equal(
      openingOfGame({ name: "King's Pawn Game: Some Newer Line", eco: "C20", startingFen: START, moves: przepiorka })?.name,
      "King's Pawn Game: Some Newer Line",
    );
  });

  it("no book line: the provider's name without its tail, or null", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    assert.deepEqual(openingOfGame({ name: "Pirc Defense Classical Variation...5.Bc4 O-O", eco: "B08", startingFen: fen, moves: "e2e4" }), {
      eco: "B08",
      name: "Pirc Defense Classical Variation",
    });
    assert.equal(openingOfGame({ name: "5.O-O", eco: null, startingFen: fen, moves: "e2e4" }), null);
    assert.equal(openingOfGame({ name: "  ", eco: null, startingFen: fen, moves: "" }), null);
  });
});
