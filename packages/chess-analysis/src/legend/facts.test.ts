// The one legend-facts rule every writer shares (phase-03 plan §8.9, P3-D24): the historical name, the skip reasons,
// and the five legend fixtures reproduced from the stored columns (names, PGN, metadata) the way the writers read them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { legendFixture, legendFixtureFacts, legendFixtureMoves } from "../../fixtures/legend";
import { historicalFullName, historicalShortName, legendFactsOf, realPlayerName, type LegendFactsInput } from "./facts";

describe("historical names", () => {
  it("short name = the surname", () => {
    assert.equal(historicalShortName("Paul Morphy"), "Morphy");
    assert.equal(historicalShortName("Kasparov, Garry"), "Kasparov");
    assert.equal(historicalShortName("  Mikhail   Tal "), "Tal");
    assert.equal(historicalShortName("Capablanca"), "Capablanca");
    assert.equal(historicalShortName("X".repeat(50)).length, 40);
  });

  it("the linked legend record wins over the position's player name; placeholders are not names", () => {
    const names = { whiteLegendName: "Paul Morphy", blackLegendName: null, whitePlayerName: "P. Morphy", blackPlayerName: "?" };
    assert.equal(historicalFullName(names, "w"), "Paul Morphy");
    assert.equal(historicalFullName(names, "b"), null);
    assert.equal(historicalFullName({ whitePlayerName: "Garry  Kasparov", blackPlayerName: null }, "w"), "Garry Kasparov");
    for (const placeholder of ["?", "??", "-", "Unknown", "various", "N/A", "na", "none", "  "]) {
      assert.equal(realPlayerName(placeholder), null, placeholder);
    }
    assert.equal(realPlayerName(" Duke Karl / Count Isouard "), "Duke Karl / Count Isouard");
  });
});

describe("legendFactsOf", () => {
  for (const name of ["opera", "kt", "opponent-left", "followed", "short-legend"]) {
    it(`reproduces the ${name} fixture from a linked record's name or the position's player name`, () => {
      const f = legendFixture(name);
      const full = `Test ${f.historicalName}`;
      const base = {
        pgn: f.legendPgn,
        gameMetadata: f.metadata,
        moveNumber: null,
        startFen: f.startFen,
        startPly: legendFixtureFacts(f).startPly,
        moves: legendFixtureMoves(f),
        member: f.member,
      };
      const viaRecord = legendFactsOf({
        ...base,
        names: {
          whiteLegendName: f.member === "w" ? full : null,
          blackLegendName: f.member === "b" ? full : null,
          whitePlayerName: null,
          blackPlayerName: null,
        },
      });
      assert.deepEqual(viaRecord, { ok: true, facts: legendFixtureFacts(f) });
      const viaPosition = legendFactsOf({
        ...base,
        names: { whitePlayerName: f.member === "w" ? full : "?", blackPlayerName: f.member === "b" ? full : "?" },
      });
      assert.deepEqual(viaPosition, viaRecord);
    });
  }

  it("names the reason when there is nothing to compare", () => {
    const f = legendFixture("opera");
    const base: LegendFactsInput = {
      names: { whitePlayerName: "Paul Morphy", blackPlayerName: null },
      pgn: f.legendPgn,
      gameMetadata: f.metadata,
      moveNumber: null,
      startFen: f.startFen,
      startPly: 18,
      moves: legendFixtureMoves(f),
      member: f.member,
    };
    const reason = (input: LegendFactsInput) => {
      const out = legendFactsOf(input);
      return out.ok ? "ok" : out.reason;
    };
    assert.equal(reason(base), "ok");
    assert.equal(reason({ ...base, names: { whitePlayerName: "Unknown", blackPlayerName: null } }), "no_name");
    assert.equal(reason({ ...base, pgn: null }), "no_pgn");
    assert.equal(reason({ ...base, pgn: "  " }), "no_pgn");
    assert.equal(reason({ ...base, moves: [] }), "no_moves");
    assert.equal(reason({ ...base, pgn: "1.d4 d5 2.c4 1-0" }), "no_line");
    // The position's PGN stops exactly at the game's start (the old dev seed's Opera score ended at 9…b5).
    assert.equal(reason({ ...base, pgn: '[Result "1-0"]\n\n1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 1-0' }), "line_ends_at_start");
    assert.equal(
      reason({ ...base, gameMetadata: null, pgn: f.legendPgn.replace(/\[Result "[^"]*"\]/, "").replace(/1-0\s*$/, "") }),
      "no_result",
    );
    assert.equal(reason({ ...base, moves: ["e2e4", "zz99"] }), "bad_moves");
  });
});
