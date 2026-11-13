// Lichess export game → ImportedGame (phase-04 plan §8.7 step 3, §12.1 row 2).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { encodeLichessGame, type LichessGameSpec } from "../../testing/encode";
import type { ImportedGame, MapResult } from "../../types";
import { evalHintOf, mapLichessGame } from "../map";

const ME = { id: "knightowl88", name: "KnightOwl88", rating: 1500, ratingDiff: 7 };
const OPP = { id: "opponent01", name: "Opponent01", rating: 1520, ratingDiff: -7 };
const SHORT = ["e4", "e5", "Nf3", "Nc6"];
const T = Date.UTC(2026, 9, 20, 12, 0, 0);

function spec(over: Partial<LichessGameSpec> = {}): LichessGameSpec {
  return {
    id: "AbCd1234",
    sans: SHORT,
    speed: "blitz",
    status: "resign",
    winner: "white",
    white: ME,
    black: OPP,
    createdAt: T - 300_000,
    lastMoveAt: T,
    clock: { initial: 300, increment: 3 },
    ...over,
  };
}

const map = (s: LichessGameSpec): MapResult => mapLichessGame(encodeLichessGame(s), { userId: "knightowl88" });
function ok(r: MapResult): ImportedGame {
  if (!r.ok) assert.fail(`expected a game, got skip ${r.reason}: ${r.detail}`);
  return r.game;
}
const reason = (r: MapResult) => (r.ok ? null : r.reason);

describe("mapLichessGame: status, winner and end method", () => {
  const table: [status: string, winner: "white" | "black" | undefined, outcome: string, method: string][] = [
    ["mate", "white", "WHITE", "CHECKMATE"],
    ["mate", "black", "BLACK", "CHECKMATE"],
    ["resign", "white", "WHITE", "RESIGNATION"],
    ["resign", "black", "BLACK", "RESIGNATION"],
    ["stalemate", undefined, "DRAW", "STALEMATE"],
    ["outoftime", "white", "WHITE", "TIMEOUT"],
    ["outoftime", "black", "BLACK", "TIMEOUT"],
    ["outoftime", undefined, "DRAW", "TIMEOUT_VS_INSUFFICIENT"],
    ["timeout", "black", "BLACK", "ABANDONED"],
    ["timeout", undefined, "DRAW", "ABANDONED"],
    ["draw", undefined, "DRAW", "AGREEMENT"],
    ["insufficientMaterialClaim", undefined, "DRAW", "INSUFFICIENT_MATERIAL"],
    ["cheat", "white", "WHITE", "OTHER"],
    ["unknownFinish", undefined, "DRAW", "OTHER"],
    ["variantEnd", "black", "BLACK", "OTHER"],
  ];
  for (const [status, winner, outcome, method] of table) {
    it(`${status} / winner ${winner ?? "none"} → ${outcome} ${method}`, () => {
      const g = ok(map(spec({ status, winner })));
      assert.equal(g.outcome, outcome);
      assert.equal(g.endMethod, method);
      const won = (winner === "white" && g.color === "w") || (winner === "black" && g.color === "b");
      assert.equal(g.memberWon, won);
      assert.equal(g.result, outcome === "DRAW" ? "DRAW" : won ? "WIN" : "LOSS");
      assert.equal(g.legacyResult, outcome === "DRAW" ? "DRAW" : won ? "CREATOR_WON" : "OPPONENT_WON");
    });
  }

  it("upgrades a draw to THREEFOLD when the replayed position is a threefold repetition", () => {
    const sans = "Nf3 Nf6 Nc3 Nc6 Nb1 Nb8 Ng1 Ng8 Nc3 Nc6 Nf3 Nf6 Ng1 Ng8 Nb1 Nb8".split(" ");
    assert.equal(ok(map(spec({ status: "draw", winner: undefined, sans }))).endMethod, "THREEFOLD");
  });

  it("upgrades a draw to FIFTY_MOVE when the fifty-move rule holds", () => {
    const g = ok(
      map(spec({ status: "draw", winner: undefined, startFen: "8/8/4k3/8/8/4K3/8/R6r w - - 98 120", sans: ["Ra7", "Rh2"] })),
    );
    assert.equal(g.endMethod, "FIFTY_MOVE");
  });

  it("skips aborted / noStart (aborted) and created / started (unfinished)", () => {
    assert.equal(reason(map(spec({ status: "aborted", winner: undefined }))), "aborted");
    assert.equal(reason(map(spec({ status: "noStart", winner: undefined }))), "aborted");
    assert.equal(reason(map(spec({ status: "created", winner: undefined }))), "unfinished");
    assert.equal(reason(map(spec({ status: "started", winner: undefined }))), "unfinished");
  });
});

describe("mapLichessGame: fields", () => {
  it("maps every speed to a TimeClass", () => {
    const want: Record<string, string> = {
      ultraBullet: "BULLET",
      bullet: "BULLET",
      blitz: "BLITZ",
      rapid: "RAPID",
      classical: "CLASSICAL",
      correspondence: "DAILY",
    };
    for (const [speed, tc] of Object.entries(want)) assert.equal(ok(map(spec({ speed }))).timeClass, tc, speed);
  });

  it("clock seconds; correspondence days → seconds; clocks centiseconds → ms, one per ply", () => {
    const g = ok(map(spec({ clocksCs: [30003, 30003, 29871, 29650, 29000] })));
    assert.equal(g.initialTimeSeconds, 300);
    assert.equal(g.incrementSeconds, 3);
    assert.deepEqual(g.moveClocksMs, [300030, 300030, 298710, 296500], "the resign-time extra entry is dropped");
    assert.equal(g.creatorTimeRemaining, 298);
    assert.equal(g.opponentTimeRemaining, 296);
    const short = ok(map(spec({ clocksCs: [30003, 30003] })));
    assert.deepEqual(short.moveClocksMs, [], "fewer clocks than plies → none");
    const corr = ok(map(spec({ speed: "correspondence", clock: undefined, daysPerTurn: 3 })));
    assert.equal(corr.initialTimeSeconds, 259_200);
    assert.equal(corr.incrementSeconds, 0);
    assert.deepEqual(corr.moveClocksMs, []);
  });

  it("fromPosition with Black to move keeps initialFen and an odd startPly", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 10";
    const g = ok(map(spec({ startFen: fen, sans: ["Nf6", "Nc3", "Bc5"] })));
    assert.equal(g.startingFen, fen);
    assert.equal(g.startPly, 19);
    assert.equal(g.startPly % 2, 1);
    assert.equal(g.moves, "g8f6 b1c3 f8c5");
    const c = new Chess(fen);
    for (const m of ["Nf6", "Nc3", "Bc5"]) c.move(m);
    assert.equal(g.fen, c.fen());
  });

  it("a fromPosition game without initialFen is a parse_error; an illegal SAN too", () => {
    const raw = encodeLichessGame(spec({ startFen: "8/8/4k3/8/8/4K3/8/R6r w - - 0 1", sans: ["Ra7", "Rh2"] }));
    delete raw.initialFen;
    assert.equal(reason(mapLichessGame(raw, { userId: "knightowl88" })), "parse_error");
    const bad = { ...encodeLichessGame(spec()), moves: "e4 e5 Ke3" };
    assert.equal(reason(mapLichessGame(bad, { userId: "knightowl88" })), "parse_error");
  });

  it("stores BOT and other titles on their side", () => {
    const g = ok(map(spec({ black: { ...OPP, title: "BOT" }, white: { ...ME, title: "LM" } })));
    assert.equal(g.blackTitle, "BOT");
    assert.equal(g.whiteTitle, "LM");
  });

  it("member side by user id: ratingBefore, ratingDelta from ratingDiff, the opponent's name and rating", () => {
    const g = ok(map(spec({ white: OPP, black: ME, winner: "black" })));
    assert.equal(g.color, "b");
    assert.equal(g.ratingBefore, 1500);
    assert.equal(g.ratingDelta, 7);
    assert.equal(g.opponentName, "Opponent01");
    assert.equal(g.opponentRating, 1520);
    assert.equal(g.whiteName, "Opponent01");
    assert.equal(g.blackName, "KnightOwl88");
    assert.equal(g.result, "WIN");
    const none = map(spec({ white: OPP, black: { id: "third", name: "Third", rating: 1 } }));
    assert.equal(reason(none), "not_participant");
  });

  it("ids, URL, dates, opening", () => {
    const g = ok(map(spec({ opening: { eco: "C44", name: "King's Pawn Game: Tayler Opening", ply: 5 } })));
    assert.equal(g.externalId, "AbCd1234");
    assert.equal(g.externalUrl, "https://lichess.org/AbCd1234");
    assert.equal(g.endedAt.getTime(), T);
    assert.equal(g.createdAtMs, T - 300_000);
    assert.equal(g.ecoCode, "C44");
    assert.equal(g.openingName, "King's Pawn Game: Tayler Opening");
    assert.equal(g.source, "LICHESS");
  });

  it("skips variants, unrated games and games shorter than 2 plies", () => {
    assert.equal(reason(map(spec({ variant: "chess960" }))), "variant");
    assert.equal(reason(map(spec({ variant: "atomic" }))), "variant");
    assert.equal(reason(map(spec({ rated: false }))), "unrated");
    assert.equal(reason(map(spec({ sans: ["e4"] }))), "too_short");
  });
});

describe("evalHint (R-LI-08)", () => {
  it("cp values per ply, white's view, clamped to ±9999", () => {
    const g = ok(map(spec({ analysis: [{ eval: 18 }, { eval: 22 }, { eval: -12000 }, { eval: 15000 }] })));
    assert.deepEqual(g.evalHint, { source: "lichess", cp: [18, 22, -9999, 9999] });
  });

  it("mate scores: sign · (30000 − |n|); mate 0 takes the mover's sign", () => {
    const g = ok(map(spec({ analysis: [{ eval: 10 }, { mate: 3 }, { mate: -2 }, { mate: 0 }] })));
    // ply 4 is Black's move (…Nc6): mate 0 after it means Black has mated.
    assert.deepEqual(g.evalHint?.cp, [10, 29997, -29998, -30000]);
  });

  it("is null when the analysis length differs from the ply count", () => {
    assert.equal(ok(map(spec({ analysis: [{ eval: 1 }, { eval: 2 }, { eval: 3 }] }))).evalHint, null);
    assert.equal(ok(map(spec({ analysis: [{ eval: 1 }, { eval: 2 }, { eval: 3 }, { eval: 4 }, { eval: 5 }] }))).evalHint, null);
    assert.equal(ok(map(spec())).evalHint, null);
  });

  it("completes a mating game whose analysis stops one ply short with the terminal mate", () => {
    const fools = ["f3", "e5", "g4", "Qh4#"];
    const g = ok(map(spec({ sans: fools, status: "mate", winner: "black", analysis: [{ eval: -50 }, { eval: -40 }, { mate: -1 }] })));
    assert.deepEqual(g.evalHint?.cp, [-50, -40, -29999, -30000]);
    assert.equal(evalHintOf([{ eval: 1 }], 3, 0, true), null, "two short is still a mismatch");
    assert.equal(evalHintOf([{ eval: 1 }, {}], 2, 0, false), null, "an entry without eval or mate");
  });
});
