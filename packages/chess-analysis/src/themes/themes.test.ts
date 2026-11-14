// The theme tagger's rules (phase-05 plan §8.11, §12.1): the primary-theme priority, meta tags never primary, the eval
// and length tags, the special moves, and the `rc:*` review heuristics on the V3BankSession design positions
// ("Recapture first", "Loose piece", "Defended pawn") and on constructed positions. Recall per Tier-1 detector on CC0
// puzzles is themes.recall.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { META_THEMES, PRIMARY_ORDER, primaryOf, RC_THEMES, tagThemes, TIER1_THEMES } from "./index";

const require = createRequire(import.meta.url);
const bankSession = JSON.parse(
  readFileSync(require.resolve("@repo/chess-fixtures/design/v3-bank-session.json"), "utf8"),
) as {
  positions: {
    fen: string;
    designLine: string[];
    played: string;
    refuteUci: string | null;
    expected: { primaryTheme: string };
  }[];
};

describe("primary theme", () => {
  it("follows the plan's order: mates > fork > pin > … > rc:* > endgame > phase", () => {
    assert.equal(primaryOf(["middlegame", "fork", "mateIn2", "mate"]), "mateIn2");
    assert.equal(primaryOf(["hangingPiece", "pin", "fork"]), "fork");
    assert.equal(primaryOf(["rc:recapture", "sacrifice"]), "sacrifice");
    assert.equal(primaryOf(["rookEndgame", "rc:missedThreat", "endgame"]), "rc:missedThreat");
    assert.equal(primaryOf(["endgame", "rookEndgame"]), "rookEndgame");
    assert.ok(PRIMARY_ORDER.indexOf("backRankMate") < PRIMARY_ORDER.indexOf("mateIn1"));
  });

  it("never picks a meta tag, and needs a phase tag at least", () => {
    for (const m of META_THEMES) assert.equal(PRIMARY_ORDER.includes(m), false, m);
    assert.throws(() => primaryOf(["short", "crushing"]), RangeError);
  });

  it("every Tier-1 and rc key is known to the order or the meta list", () => {
    for (const t of [...TIER1_THEMES, ...RC_THEMES]) {
      assert.ok(PRIMARY_ORDER.includes(t) || META_THEMES.includes(t), t);
    }
  });
});

describe("tagThemes on constructed lines", () => {
  it("a back-rank mate in one: mate, mateIn1, backRankMate, oneMove; primary backRankMate", () => {
    const out = tagThemes({ fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", line: ["a1a8"] });
    for (const t of ["mate", "mateIn1", "backRankMate", "oneMove"]) assert.ok(out.themes.includes(t), t);
    assert.equal(out.primary, "backRankMate");
  });

  it("a smothered mate", () => {
    const out = tagThemes({ fen: "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", line: ["g5f7"] });
    assert.ok(out.themes.includes("smotheredMate"));
    assert.equal(out.primary, "smotheredMate");
  });

  it("a knight fork of king and rook, then the capture", () => {
    const out = tagThemes({ fen: "r3k3/8/8/8/8/8/2N5/4K3 w - - 0 1", line: ["c2d4", "e8e7", "d4c6"] });
    assert.equal(out.themes.includes("fork"), false, "Nd4 attacks nothing twice");
    const fork = tagThemes({ fen: "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", line: ["b5c7", "e8d7", "c7a8"] });
    assert.ok(fork.themes.includes("fork"));
    assert.equal(fork.primary, "fork");
  });

  it("a skewer: the king is checked along a line and the rook behind it falls", () => {
    const skewer = tagThemes({ fen: "r1k5/8/8/8/8/8/8/6RK w - - 0 1", line: ["g1g8", "c8d7", "g8a8"] });
    assert.ok(skewer.themes.includes("skewer"));
    // The same check with nothing behind the king is no skewer.
    const none = tagThemes({ fen: "2k5/8/8/8/8/8/8/6RK w - - 0 1", line: ["g1g8", "c8d7", "g8a8"] });
    assert.equal(none.themes.includes("skewer"), false);
  });

  it("a double check", () => {
    // Nf6+ uncovers the rook on e1 against the king on e8: two checkers.
    const out = tagThemes({ fen: "4k3/8/8/8/4N3/8/8/4RK2 w - - 0 1", line: ["e4f6"] });
    assert.ok(out.themes.includes("doubleCheck"));
    assert.ok(out.themes.includes("discoveredAttack"));
  });

  it("promotion and underPromotion, advancedPawn with them", () => {
    const q = tagThemes({ fen: "8/4P3/8/8/8/8/k7/4K3 w - - 0 1", line: ["e7e8q"] });
    assert.ok(q.themes.includes("promotion") && q.themes.includes("advancedPawn"));
    assert.equal(q.themes.includes("underPromotion"), false);
    const n = tagThemes({ fen: "8/4P3/8/8/8/8/k7/4K3 w - - 0 1", line: ["e7e8n"] });
    assert.ok(n.themes.includes("underPromotion"));
  });

  it("en passant and castling are special-move tags", () => {
    const ep = tagThemes({ fen: "4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 2", line: ["d5e6"] });
    assert.ok(ep.themes.includes("enPassant"));
    const castle = tagThemes({ fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1", line: ["e1g1"] });
    assert.ok(castle.themes.includes("castling"));
  });

  it("eval tags from a known engine eval, never for a mating line", () => {
    const base = { fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1", line: ["a1a7"] };
    const tag = (cp: number) => tagThemes({ ...base, cp }).themes;
    assert.ok(tag(601).includes("crushing"));
    assert.ok(tag(600).includes("advantage"));
    assert.ok(tag(200).includes("advantage"));
    assert.ok(tag(199).includes("equality"));
    assert.equal(tagThemes(base).themes.some((t) => ["crushing", "advantage", "equality"].includes(t)), false);
    const mate = tagThemes({ fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", line: ["a1a8"], cp: 1000, mateIn: 1 });
    assert.equal(mate.themes.some((t) => ["crushing", "advantage", "equality"].includes(t)), false);
  });

  it("length tags count the solver's moves", () => {
    const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
    assert.ok(tagThemes({ fen, line: ["a1a2"] }).themes.includes("oneMove"));
    assert.ok(tagThemes({ fen, line: ["a1a2", "e8e7", "a2a3"] }).themes.includes("short"));
    assert.ok(tagThemes({ fen, line: ["a1a2", "e8e7", "a2a3", "e7e8", "a3a4"] }).themes.includes("long"));
    assert.ok(
      tagThemes({ fen, line: ["a1a2", "e8e7", "a2a3", "e7e8", "a3a4", "e8e7", "a4a5"] }).themes.includes("veryLong"),
    );
  });

  it("an endgame signature and the phase tag", () => {
    const rook = tagThemes({ fen: "4k3/4p3/8/8/8/8/4P3/R3K3 w - - 0 1", line: ["a1a8"] });
    assert.ok(rook.themes.includes("rookEndgame") && rook.themes.includes("endgame"));
    const opening = tagThemes({ fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", line: ["g1f3"] });
    assert.ok(opening.themes.includes("opening"));
  });
});

describe("rc:* review heuristics", () => {
  it("tags the three V3BankSession positions with the design's themes", () => {
    for (const p of bankSession.positions) {
      const out = tagThemes({
        fen: p.fen,
        line: [p.designLine[0]!],
        review: { playedUci: p.played, refuteUci: p.refuteUci, pv: p.designLine, phase: "MIDDLEGAME" },
      });
      assert.equal(out.primary, p.expected.primaryTheme, `${p.fen}: ${out.themes.join(" ")}`);
    }
  });

  it("run only for review positions, and only when the member's move differs from the best", () => {
    const p = bankSession.positions[0]!;
    assert.equal(tagThemes({ fen: p.fen, line: [p.designLine[0]!] }).themes.includes("rc:recapture"), false);
    const same = tagThemes({ fen: p.fen, line: [p.designLine[0]!], review: { playedUci: p.designLine[0]!, pv: p.designLine } });
    assert.equal(same.themes.some((t) => t.startsWith("rc:")), false);
  });

  it("rc:recapture: the best move takes back on the square the opponent's capture landed on", () => {
    // Black just played …Bxc3 (bxc3 is the recapture); the member played h3 instead.
    const out = tagThemes({
      fen: "rnbqk2r/pppp1ppp/5n2/4p3/4P3/2b2N2/PPPP1PPP/R1BQKB1R w KQkq - 0 4",
      line: ["d2c3"],
      setupUci: "b4c3",
      setupCaptured: true,
      review: { playedUci: "h2h3" },
    });
    assert.ok(out.themes.includes("rc:recapture"));
  });

  it("rc:pawnStructure: the played pawn capture doubles and isolates, the best move does not", () => {
    const out = tagThemes({
      fen: "4k3/8/8/8/4P3/4n3/3K1P2/8 w - - 0 1",
      line: ["d2e3"],
      review: { playedUci: "f2e3" },
    });
    assert.ok(out.themes.includes("rc:pawnStructure"));
  });

  it("rc:kingSafety: pushing a pawn of the castled king's shelter", () => {
    const out = tagThemes({
      fen: "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7",
      line: ["c1g5"],
      review: { playedUci: "g2g4" },
    });
    assert.ok(out.themes.includes("rc:kingSafety"));
  });

  it("rc:development: in the opening the best move develops a minor piece and the played one does not", () => {
    const out = tagThemes({
      fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      line: ["g1f3"],
      review: { playedUci: "h2h3", phase: "OPENING" },
    });
    assert.ok(out.themes.includes("rc:development"));
  });

  it("rc:missedThreat: the opponent's reply to the played move wins at least 2 pawns", () => {
    const out = tagThemes({
      fen: "4k3/8/8/8/8/8/1b6/R3K3 w - - 0 1",
      line: ["a1a8"],
      review: { playedUci: "e1f1", refuteUci: "b2a1" },
    });
    assert.ok(out.themes.includes("rc:missedThreat"));
  });
});
