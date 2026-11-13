// The recorder's anonymiser (phase-04 plan §12.5 "recorded"): names, ids, uuids and links replaced everywhere they
// appear, unknown PGN headers dropped, moves and clocks untouched, opponents numbered consistently.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { encodeChessComGame } from "../src/testing/encode";
import { anonymiseMonth, FIXTURE_MEMBER } from "./lib/anonymise";

const game = (id: number, white: string, black: string) => {
  const g = encodeChessComGame({
    id,
    kind: id > 1e10 ? "live" : "daily",
    sans: ["e4", "e5", "Nf3"],
    white: { username: white, rating: 1500, result: "win" },
    black: { username: black, rating: 1490, result: "resigned" },
    timeClass: id > 1e10 ? "blitz" : "daily",
    timeControl: id > 1e10 ? "180+2" : "1/86400",
    endTime: 1_790_000_000,
    clocksMs: [179_900, 179_000, 170_100],
    termination: `${white} won by resignation`,
  });
  g.pgn = (g.pgn as string).replace("[Site ", `[Tournament "Real Club Arena"]\n[Site `);
  g.match = "https://api.chess.com/pub/match/123456";
  return g;
};

describe("anonymiseMonth", () => {
  it("replaces every identifying field and keeps the chess", () => {
    const raw = [game(186_169_734_672, "RealMember", "SomeRival"), game(1_034_847_688, "SomeRival", "realmember")];
    const { games, droppedHeaders } = anonymiseMonth(raw, "RealMember");
    const text = JSON.stringify(games);
    for (const s of ["RealMember", "realmember", "SomeRival", "186169734672", "1034847688", "Real Club Arena", "123456"])
      assert.ok(!text.includes(s), `no ${s}`);
    assert.deepEqual(droppedHeaders, ["Tournament"]);
    const [a, b] = games as { white: { username: string }; black: { username: string }; pgn: string; url: string }[];
    assert.equal(a!.white.username, FIXTURE_MEMBER);
    assert.equal(a!.black.username, "opponent_01");
    assert.equal(b!.white.username, "opponent_01", "the same opponent keeps one alias");
    assert.equal(b!.black.username, FIXTURE_MEMBER);
    assert.match(a!.url, /\/game\/live\/\d+$/);
    assert.match(b!.url, /\/game\/daily\/\d+$/);
    assert.match(a!.pgn, /\[Termination "knightowl_88 won by resignation"\]/);
    assert.match(a!.pgn, /1\. e4 \{\[%clk 0:02:59\.9\]\} 1\.\.\. e5 \{\[%clk 0:02:59\]\}/);
    assert.ok(a!.pgn.includes(`[Link "${a!.url}"]`));
  });

  it("honours the limit", () => {
    const raw = [game(186_169_734_672, "m", "o1"), game(186_169_734_673, "m", "o2"), game(186_169_734_674, "m", "o3")];
    assert.equal(anonymiseMonth(raw, "m", 2).games.length, 2);
  });
});
