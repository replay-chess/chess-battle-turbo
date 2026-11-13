// Chess.com archive game → ImportedGame (phase-04 plan §8.6 mapping table, §12.1 row 1).
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Chess } from "chess.js";
import { encodeChessComGame, type ChessComGameSpec } from "../../testing/encode";
import { INITIAL_FEN } from "../../replay";
import type { ImportedGame, MapResult } from "../../types";
import {
  CHESSCOM_END_METHODS,
  externalIdOf,
  mapChessComGame,
  openingNameFromEcoUrl,
  parseTimeControl,
  previewOf,
  ratedGamesTotal,
} from "../map";
import { CHESSCOM_DRAW_CODES, CHESSCOM_RESULT_CODES } from "../types";

const ME = "KnightOwl_88";
const SHORT = ["e4", "e5", "Nf3", "Nc6"];

function spec(over: Partial<ChessComGameSpec> = {}): ChessComGameSpec {
  return {
    id: 123456789,
    sans: SHORT,
    white: { username: ME, rating: 1184, result: "win" },
    black: { username: "Opponent01", rating: 1201, result: "resigned" },
    timeClass: "rapid",
    timeControl: "600",
    endTime: Date.UTC(2026, 9, 14, 18, 0, 0) / 1000,
    ...over,
  };
}

const map = (s: ChessComGameSpec, memberTitle?: string | null): MapResult =>
  mapChessComGame(encodeChessComGame(s), { usernameLower: ME.toLowerCase(), memberTitle });

function ok(r: MapResult): ImportedGame {
  if (!r.ok) assert.fail(`expected a game, got skip ${r.reason}: ${r.detail}`);
  return r.game;
}

describe("mapChessComGame: results", () => {
  const decisive = CHESSCOM_RESULT_CODES.filter((c) => c !== "win" && !CHESSCOM_DRAW_CODES.has(c));
  const draws = CHESSCOM_RESULT_CODES.filter((c) => CHESSCOM_DRAW_CODES.has(c));

  it("covers all 15 result codes", () => {
    assert.equal(CHESSCOM_RESULT_CODES.length, 15);
    assert.equal(decisive.length + draws.length + 1, 15);
  });

  for (const code of decisive) {
    for (const winner of ["white", "black"] as const) {
      for (const memberColour of ["w", "b"] as const) {
        it(`${code}: ${winner} wins, member plays ${memberColour}`, () => {
          const me = { username: ME, rating: 1184 };
          const them = { username: "Opponent01", rating: 1201 };
          const whiteSide = memberColour === "w" ? me : them;
          const blackSide = memberColour === "w" ? them : me;
          const g = ok(
            map(
              spec({
                white: { ...whiteSide, result: winner === "white" ? "win" : code },
                black: { ...blackSide, result: winner === "black" ? "win" : code },
              }),
            ),
          );
          assert.equal(g.outcome, winner === "white" ? "WHITE" : "BLACK");
          assert.equal(g.endMethod, CHESSCOM_END_METHODS[code] ?? "OTHER");
          const won = (winner === "white") === (memberColour === "w");
          assert.equal(g.color, memberColour);
          assert.equal(g.memberWon, won);
          assert.equal(g.result, won ? "WIN" : "LOSS");
          assert.equal(g.legacyResult, won ? "CREATOR_WON" : "OPPONENT_WON");
          assert.equal(g.ratingBefore, 1184);
          assert.equal(g.opponentName, "Opponent01");
          assert.equal(g.opponentRating, 1201);
        });
      }
    }
  }

  for (const code of draws) {
    for (const memberColour of ["w", "b"] as const) {
      it(`${code}: draw, member plays ${memberColour}`, () => {
        const me = { username: ME, rating: 1184, result: code };
        const them = { username: "Opponent01", rating: 1201, result: code };
        const g = ok(map(spec({ white: memberColour === "w" ? me : them, black: memberColour === "w" ? them : me })));
        assert.equal(g.outcome, "DRAW");
        assert.equal(g.endMethod, CHESSCOM_END_METHODS[code]);
        assert.equal(g.result, "DRAW");
        assert.equal(g.legacyResult, "DRAW");
        assert.equal(g.memberWon, false);
      });
    }
  }

  it("unmapped decisive codes become OTHER", () => {
    for (const code of ["lose", "kingofthehill", "threecheck", "bughousepartnerlose"]) {
      const g = ok(map(spec({ black: { username: "Opponent01", rating: 1201, result: code } })));
      assert.equal(g.endMethod, "OTHER", code);
    }
  });

  it("a result pair with no winner and no draw is a parse_error", () => {
    const r = map(spec({ white: { username: ME, rating: 1, result: "resigned" } }));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "parse_error");
  });
});

describe("mapChessComGame: fields", () => {
  it("parses time controls", () => {
    assert.deepEqual(parseTimeControl("180+2"), { initialTimeSeconds: 180, incrementSeconds: 2 });
    assert.deepEqual(parseTimeControl("600"), { initialTimeSeconds: 600, incrementSeconds: 0 });
    assert.deepEqual(parseTimeControl("1/86400"), { initialTimeSeconds: 86400, incrementSeconds: 0 });
    assert.equal(parseTimeControl("-"), null);
    const g = ok(map(spec({ timeControl: "180+2", timeClass: "blitz" })));
    assert.equal(g.initialTimeSeconds, 180);
    assert.equal(g.incrementSeconds, 2);
    assert.equal(g.timeClass, "BLITZ");
    const d = ok(map(spec({ timeControl: "1/86400", timeClass: "daily", kind: "daily" })));
    assert.equal(d.timeClass, "DAILY");
    assert.equal(d.initialTimeSeconds, 86400);
    assert.equal(ok(map(spec({ timeControl: "60", timeClass: "bullet" }))).timeClass, "BULLET");
    const bad = map(spec({ timeControl: "abc" }));
    assert.equal(!bad.ok && bad.reason, "parse_error");
  });

  it("takes externalId from live and daily URLs, else the uuid", () => {
    assert.equal(externalIdOf("https://www.chess.com/game/live/186169734672", "u"), "186169734672");
    assert.equal(externalIdOf("https://www.chess.com/game/daily/1034847688", "u"), "1034847688");
    assert.equal(externalIdOf("https://www.chess.com/analysis/game/x", "1a2b-uuid"), "1a2b-uuid");
    const g = ok(map(spec({ id: 987, kind: "daily", timeClass: "daily", timeControl: "1/86400" })));
    assert.equal(g.externalId, "987");
    assert.equal(g.externalUrl, "https://www.chess.com/game/daily/987");
    assert.equal(g.source, "CHESSCOM");
  });

  it("finds the member's colour case-insensitively; neither side → not_participant", () => {
    const g = ok(
      map(
        spec({
          white: { username: "opponent01", rating: 900, result: "resigned" },
          black: { username: "KNIGHTOWL_88", rating: 1184, result: "win" },
        }),
      ),
    );
    assert.equal(g.color, "b");
    assert.equal(g.result, "WIN");
    const none = map(spec({ white: { username: "someone", rating: 900, result: "win" } }));
    assert.equal(!none.ok && none.reason, "not_participant");
  });

  it("reads %clk with and without tenths into per-ply ms, and the legacy remaining seconds", () => {
    const g = ok(map(spec({ clocksMs: [599_900, 598_000, 590_100, 585_000] })));
    assert.deepEqual(g.moveClocksMs, [599_900, 598_000, 590_100, 585_000]);
    assert.equal(g.creatorTimeRemaining, 590, "member (white) last clock 590.1 s");
    assert.equal(g.opponentTimeRemaining, 585);
    const pgn = encodeChessComGame(spec({ clocksMs: [599_900, 598_000, 590_100, 585_000] })).pgn as string;
    assert.match(pgn, /\{\[%clk 0:09:59\.9\]\}/);
    assert.match(pgn, /\{\[%clk 0:09:58\]\}/);
  });

  it("has no clocks when a ply lacks one (and the legacy seconds fall back to 0)", () => {
    const g = ok(map(spec()));
    assert.deepEqual(g.moveClocksMs, []);
    assert.equal(g.creatorTimeRemaining, 0);
    assert.equal(g.opponentTimeRemaining, 0);
  });

  it("writes promotions, under-promotions, castling and en passant as UCI", () => {
    const promo = ok(map(spec({ startFen: "8/4P1k1/8/8/8/8/8/4K3 w - - 0 40", sans: ["e8=Q", "Kh6", "Qe3+"] })));
    assert.equal(promo.moves, "e7e8q g7h6 e8e3");
    const under = ok(map(spec({ startFen: "8/4P1k1/8/8/8/8/8/4K3 w - - 0 40", sans: ["e8=N+", "Kf7"] })));
    assert.equal(under.moves.split(" ")[0], "e7e8n");
    const oo = ok(map(spec({ sans: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O", "Nf6"] })));
    assert.equal(oo.moves.split(" ")[6], "e1g1");
    const ooo = ok(map(spec({ sans: ["d4", "d5", "Nc3", "Nc6", "Bf4", "Bf5", "Qd2", "Qd7", "O-O-O", "O-O-O"] })));
    assert.deepEqual(ooo.moves.split(" ").slice(8), ["e1c1", "e8c8"]);
    const ep = ok(map(spec({ sans: ["e4", "Nf6", "e5", "d5", "exd6"] })));
    assert.equal(ep.moves.split(" ")[4], "e5d6");
    assert.equal(ep.plyCount, 5);
  });

  it("keeps a custom initial_setup with Black to move and its startPly", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 10";
    const g = ok(map(spec({ startFen: fen, sans: ["Nf6", "Nc3", "Bc5"], timeClass: "daily", timeControl: "1/86400" })));
    assert.equal(g.startingFen, fen);
    assert.equal(g.startPly, 19);
    assert.equal(g.plyCount, 3);
    const c = new Chess(fen);
    for (const m of ["Nf6", "Nc3", "Bc5"]) c.move(m);
    assert.equal(g.fen, c.fen());
    assert.equal(ok(map(spec())).startingFen, INITIAL_FEN);
  });

  it("skips variants, unrated games and games shorter than 2 plies", () => {
    const v = map(spec({ rules: "chess960" }));
    assert.deepEqual(!v.ok && v.reason, "variant");
    const u = map(spec({ rated: false }));
    assert.deepEqual(!u.ok && u.reason, "unrated");
    const s = map(spec({ sans: ["e4"] }));
    assert.deepEqual(!s.ok && s.reason, "too_short");
    const z = map(spec({ sans: [] }));
    assert.deepEqual(!z.ok && z.reason, "too_short");
  });

  it("a final FEN that disagrees with the PGN on the last ply is a parse_error, never stored", () => {
    const c = new Chess();
    for (const m of ["e4", "e5", "Nf3"]) c.move(m);
    const r = map(spec({ fenOverride: c.fen() })); // the archive is one ply behind the PGN
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.reason, "parse_error");
    assert.match(!r.ok ? r.detail : "", /fen/);
  });

  it("an illegal or unreadable PGN is a parse_error", () => {
    const raw = encodeChessComGame(spec());
    raw.pgn = (raw.pgn as string).replace("2. Nf3", "2. Nf6");
    const r = mapChessComGame(raw, { usernameLower: ME.toLowerCase() });
    assert.equal(!r.ok && r.reason, "parse_error");
    const junk = { ...encodeChessComGame(spec()), pgn: "[Event \"x\"]\n\n1. e4 (1. d4) e5 1-0" };
    assert.equal(mapChessComGame(junk, { usernameLower: "knightowl_88" }).ok, false);
    assert.equal(mapChessComGame({ url: 1 }, { usernameLower: "x" }).ok, false);
  });

  it("turns the ECOUrl slug into an opening name (≤ 80 chars, no markup) and keeps the ECO code", () => {
    assert.equal(
      openingNameFromEcoUrl("https://www.chess.com/openings/Scandinavian-Defense-Mieses-Kotroc-Variation"),
      "Scandinavian Defense Mieses Kotroc Variation",
    );
    assert.equal(
      openingNameFromEcoUrl("https://www.chess.com/openings/Pirc-Defense-Classical-Variation...5.Bc4-O-O-6.O-O-Nxe4"),
      "Pirc Defense Classical Variation...5.Bc4 O-O 6.O-O Nxe4",
    );
    assert.equal(openingNameFromEcoUrl("https://www.chess.com/openings/Kings-Gambit-%3Cb%3EAccepted%3C%2Fb%3E"), "Kings Gambit Accepted");
    assert.equal(openingNameFromEcoUrl(null), null);
    const long = `https://www.chess.com/openings/${"Very-Long-Opening-Name-".repeat(8)}End`;
    assert.ok(openingNameFromEcoUrl(long)!.length <= 80);
    const g = ok(map(spec({ eco: "C50", ecoUrl: "https://www.chess.com/openings/Italian-Game" })));
    assert.equal(g.ecoCode, "C50");
    assert.equal(g.openingName, "Italian Game");
    assert.equal(ok(map(spec({ eco: "Z99" }))).ecoCode, null);
  });

  it("truncates the opponent's name to 40 chars and sets the member's title only on their side", () => {
    const long = "o".repeat(55);
    const g = ok(map(spec({ black: { username: long, rating: 1500, result: "resigned" } }), "FM"));
    assert.equal(g.opponentName.length, 40);
    assert.equal(g.blackName.length, 40);
    assert.equal(g.whiteTitle, "FM");
    assert.equal(g.blackTitle, null);
  });

  it("dates: endedAt is end_time in UTC; createdAtMs from start_time on daily games", () => {
    const end = Date.UTC(2026, 9, 31, 23, 30, 0) / 1000;
    const g = ok(map(spec({ endTime: end, kind: "daily", timeClass: "daily", timeControl: "1/86400", startTime: end - 86400 })));
    assert.equal(g.endedAt.toISOString(), "2026-10-31T23:30:00.000Z");
    assert.equal(g.createdAtMs, (end - 86400) * 1000);
    assert.equal(g.ratingDelta, null, "Chess.com archives carry no rating change");
    assert.equal(g.evalHint, null);
  });
});

describe("previewOf / ratedGamesTotal", () => {
  it("builds the lookup card and the all-time rated total over the four classes", () => {
    const stats = {
      chess_rapid: { last: { rating: 1184, date: 1 }, record: { win: 100, loss: 90, draw: 10 } },
      chess_blitz: { last: { rating: 1032, date: 1 }, record: { win: 80, loss: 70, draw: 5 } },
      chess_bullet: { last: { rating: 871, date: 1 }, record: { win: 60, loss: 60, draw: 5 } },
      chess960_daily: { last: { rating: 1500, date: 1 }, record: { win: 9, loss: 9, draw: 9 } },
    };
    assert.equal(ratedGamesTotal(stats), 480);
    const p = previewOf(
      {
        "@id": "x",
        url: "x",
        username: "KnightOwl_88",
        player_id: 1,
        status: "basic",
        country: "https://api.chess.com/pub/country/IN",
      },
      stats,
    );
    assert.deepEqual(p.ratings, { rapid: 1184, blitz: 1032, bullet: 871, daily: null });
    assert.equal(p.profile.country, "IN");
    assert.equal(p.profile.name, "KnightOwl_88");
    assert.equal(p.ratedGames, 480);
  });
});
