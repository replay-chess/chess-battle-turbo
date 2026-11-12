// The book set from the seed openings (phase-03 plan task A6 acceptance, §8.4 rule 2). The seed lines are the TSVs
// the dev seed loads into `openings` (packages/db/prisma/opening-seed.ts reads apps/web/public/openings/*.tsv).
//
// The plan's acceptance says "≥ 25k EPDs"; its own §9.4 estimate ("~30–40k EPDs from replaying every
// openings.pgn") counts the positions along the lines. Measured: 34,904 positions on 3,641 lines, of which 7,484
// EPDs are distinct (lines share their early moves). Both numbers are asserted, so a seed change that loses lines or
// breaks a replay fails here.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { epdOf, INITIAL_FEN } from "./board";
import { buildBookSet, deepestOpening, movetextSans, parseOpeningsTsv, replayOpening } from "./book";
import { classifyGame } from "./classify";
import { J } from "./codec";
import { replaySan } from "./replay";

const OPENINGS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/web/public/openings");
const lines = ["a", "b", "c", "d", "e"].flatMap((f) =>
  parseOpeningsTsv(readFileSync(path.join(OPENINGS_DIR, `${f}.tsv`), "utf8")),
);
const built = buildBookSet(lines.map((l) => l.pgn));

describe("book set from the seed openings", () => {
  it("replays every seed line", () => {
    assert.equal(built.lines, 3641);
    assert.deepEqual(built.failures, []);
  });

  it("≥ 25k positions along the lines, 7,484 distinct EPDs", () => {
    assert.ok(built.positions >= 25_000, `positions ${built.positions}`);
    assert.equal(built.positions, 34_904);
    assert.equal(built.book.size, 7_484);
  });

  it("holds transpositions by EPD and not the start position", () => {
    const viaNf3 = replaySan(INITIAL_FEN, ["Nf3", "Nf6", "d4", "d5"]);
    const viaD4 = replaySan(INITIAL_FEN, ["d4", "d5", "Nf3", "Nf6"]);
    assert.equal(viaNf3.epds[4], viaD4.epds[4]);
    assert.ok(built.book.has(viaD4.epds[4] as string));
    assert.ok(!built.book.has(epdOf(INITIAL_FEN)));
  });

  it("feeds rule 2: theory is BOOK until the first move off the book", () => {
    const replay = replaySan(INITIAL_FEN, ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "Qe2", "h5", "h4"]);
    const evals = new Array<number>(replay.uci.length + 1).fill(20);
    const codes = classifyGame({ replay, evals, isBook: (e) => built.book.has(e) }).map((g) => g.code);
    // 5.Qe2 is the Wormald Attack (C77, in the seed); 5…h5 is not theory, and nothing after it is BOOK.
    assert.deepEqual(codes.slice(0, 9), new Array(9).fill(J.BOOK));
    assert.ok(codes.slice(9).every((c) => c !== J.BOOK));
  });
});

describe("book helpers", () => {
  it("reads movetext with or without spaces after the numbers", () => {
    assert.deepEqual(movetextSans("1. e4 e5 2. Nf3"), ["e4", "e5", "Nf3"]);
    assert.deepEqual(movetextSans("1.e4 e5 2.Nf3 {a comment} Nc6 $1 1-0"), ["e4", "e5", "Nf3", "Nc6"]);
    assert.deepEqual(movetextSans("1...e5"), ["e5"]);
  });

  it("stops a line at its first illegal move and reports it", () => {
    const r = replayOpening("1. e4 e5 2. Ke3");
    assert.equal(r.epds.length, 2);
    assert.equal(r.failedAt, "Ke3");
    const b = buildBookSet(["1. e4 e5", "1. d4 Qxd4"]);
    assert.deepEqual(b.failures, [{ index: 1, san: "Qxd4" }]);
    assert.equal(b.book.size, 3);
  });

  it("parses the TSV and skips the header and blank or short rows", () => {
    const rows = parseOpeningsTsv("eco\tname\tpgn\nA00\tAmar Opening\t1. Nh3\n\nB00\tbroken\n");
    assert.deepEqual(rows, [{ eco: "A00", name: "Amar Opening", pgn: "1. Nh3" }]);
  });

  it("deepestOpening picks the last position that ends an opening line", () => {
    const g = replaySan(INITIAL_FEN, ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "h3"]);
    const byEpd = new Map<string, string>();
    for (const l of lines) {
      const r = replayOpening(l.pgn);
      const last = r.epds.at(-1);
      if (last) byEpd.set(last, `${l.eco} ${l.name}`);
    }
    const hit = deepestOpening(g.epds, byEpd);
    assert.ok(hit?.startsWith("C68") || hit?.startsWith("C70"), `got ${hit}`);
    assert.equal(deepestOpening([epdOf(INITIAL_FEN)], byEpd), null);
  });
});
