// divider.ts (phase-03 plan §8.3, §12.1; task A3 acceptance: the oracle divisions within ±1 ply on ≥ 28/30).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadOracleGames, oracleReplay } from "../fixtures/oracle";
import { INITIAL_FEN, placement } from "./board";
import { divide, mixedness } from "./divider";
import { replaySan } from "./replay";

describe("divider", () => {
  it("reproduces Lichess's division for every oracle game (±1 ply; all 30 are exact today)", () => {
    const games = loadOracleGames();
    const within = (ours: number | null, theirs: number | undefined) =>
      theirs === undefined ? ours === null : ours !== null && Math.abs(ours - theirs) <= 1;
    const off: string[] = [];
    let exact = 0;
    for (const g of games) {
      const d = divide(oracleReplay(g).fens);
      if (!within(d.middlegamePly, g.division.middle) || !within(d.endgamePly, g.division.end)) {
        off.push(`${g.id}: ours ${JSON.stringify(d)}, Lichess ${JSON.stringify(g.division)}`);
      }
      if (d.middlegamePly === (g.division.middle ?? null) && d.endgamePly === (g.division.end ?? null)) exact++;
    }
    assert.deepEqual(off, []);
    assert.equal(exact, 30);
  });

  it("scores the initial position as an opening", () => {
    assert.equal(mixedness(placement(INITIAL_FEN)), 0);
    assert.deepEqual(divide([INITIAL_FEN]), { middlegamePly: null, endgamePly: null });
  });

  it("starts the middlegame when a back rank has fewer than 4 pieces", () => {
    // White's first rank keeps R, Q, K (3 pieces); everything else is still at home.
    const sparse = "rnbqkbnr/pppppppp/8/8/8/2NBBN2/PPPPPPPP/R2QK3 w Qkq - 0 1";
    assert.deepEqual(divide([INITIAL_FEN, INITIAL_FEN, sparse]), { middlegamePly: 2, endgamePly: null });
  });

  it("starts the middlegame at 10 knights, bishops, rooks and queens, and the endgame at 6", () => {
    // 10 majors and minors (back ranks full of kings and pawns so only the piece count can trigger).
    const ten = "r1bqk1nr/pppppppp/8/8/8/8/PPPPPPPP/R1BQK1NR w KQkq - 0 1";
    const six = "r2qk2r/pppppppp/8/8/8/8/PPPPPPPP/R3K1NR w KQkq - 0 1";
    assert.deepEqual(divide([INITIAL_FEN, ten, ten, six]), { middlegamePly: 1, endgamePly: 3 });
  });

  it("puts a FEN start that is already an endgame at endgamePly 0 with no middlegame", () => {
    const r = replaySan("8/5pk1/6p1/8/3R4/6P1/5PK1/3r4 w - - 0 40", ["Rd7", "Rd2", "Rxf7+", "Kxf7"]);
    assert.deepEqual(divide(r.fens), { middlegamePly: null, endgamePly: 0 });
  });
});
