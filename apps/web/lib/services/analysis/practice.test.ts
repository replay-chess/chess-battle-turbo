// Practice context rules (phase-03 plan §4.8, §5.9, §11.2 rule 6): the FEN validation (legal, one king each, no pawn
// on the first or last rank, the side not to move not in check), the copy per source, the ply range, the legend's
// plan line at the divergence, and the one statement per source (the SQL runs in test/api/archive.contract.int.test.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PracticeContextDTO } from "@repo/contracts/http/practice";
import type { Prisma } from "@repo/db";
import { isApiError } from "@/lib/api/api-error";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { fenContext, fenProblem, gameContextOf, getPracticeContext, positionContextOf, practiceGameSql } from "./practice";

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const OPERA_START = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

describe("fenProblem", () => {
  const rows: [string, string, ReturnType<typeof fenProblem>][] = [
    ["the initial position", INITIAL, null],
    ["a bare endgame, Black to move", "8/8/8/4k3/8/8/4P3/4K3 b - - 0 1", null],
    ["five fields", "8/8/8/4k3/8/8/4P3/4K3 b - - 0", "malformed"],
    ["garbage", "not a fen at all x y", "malformed"],
    ["no white king", "4k3/8/8/8/8/8/8/8 w - - 0 1", "kings"],
    ["two black kings", "k3k3/8/8/8/8/8/8/4K3 w - - 0 1", "kings"],
    ["a pawn on the 8th rank", "P3k3/8/8/8/8/8/8/4K3 w - - 0 1", "pawn_rank"],
    ["a pawn on the 1st rank", "4k3/8/8/8/8/8/8/p3K3 w - - 0 1", "pawn_rank"],
    ["the side not to move is in check", "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1", "opposite_check"],
  ];
  for (const [name, fen, expected] of rows) it(`${name} → ${expected ?? "ok"}`, () => assert.equal(fenProblem(fen), expected));

  it("?fen= answers 400 validation_failed with details.reason illegal_position", () => {
    assert.throws(
      () => fenContext("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1"),
      (e) => isApiError(e) && e.code === "validation_failed" && (e.details as { reason?: string }).reason === "illegal_position",
    );
  });

  it("a legal FEN: the side to move plays, Back goes to /play, no compare", () => {
    const ctx = PracticeContextDTO.parse(fenContext("  8/8/8/4k3/8/8/4P3/4K3 b - - 0 1 "));
    assert.deepEqual(
      { f: ctx.fen, s: ctx.sideToMove, h: ctx.humanColor, b: ctx.backHref, c: ctx.compareHref, from: ctx.fromLabel },
      { f: "8/8/8/4k3/8/8/4P3/4K3 b - - 0 1", s: "b", h: "b", b: "/play", c: null, from: null },
    );
  });
});

describe("?position=", () => {
  it("the players as the title, the side to move plays, Back to the position page", () => {
    const ctx = PracticeContextDTO.parse(
      positionContextOf({
        referenceId: "cpos00000000000000000000",
        fen: OPERA_START,
        moveNumber: 10,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl / Count Isouard",
        tournamentName: "Paris Opera",
        eventYear: 1858,
      }),
    );
    assert.deepEqual(
      { t: ctx.title, h: ctx.humanColor, from: ctx.fromLabel, b: ctx.backHref },
      { t: "Paul Morphy vs Duke Karl / Count Isouard", h: "w", from: "Practice · from move 10", b: "/position/cpos00000000000000000000" },
    );
    const event = positionContextOf({
      referenceId: "cpos00000000000000000000",
      fen: OPERA_START,
      moveNumber: null,
      whitePlayerName: null,
      blackPlayerName: null,
      tournamentName: "Paris Opera",
      eventYear: 1858,
    });
    assert.deepEqual({ t: event.title, from: event.fromLabel }, { t: "Paris Opera 1858", from: "Practice · from move 10" });
  });

  it("a stored position that is not legal is a 404 (never an engine input)", () => {
    assert.throws(
      () =>
        positionContextOf({
          referenceId: "cpos00000000000000000000",
          fen: "4k3/8/8/8/8/8/4R3/4K3 w - - 0 1",
          moveNumber: 1,
          whitePlayerName: null,
          blackPlayerName: null,
          tournamentName: null,
          eventYear: null,
        }),
      (e) => isApiError(e) && e.code === "not_found",
    );
  });
});

describe("?game=", () => {
  const base = {
    referenceId: "cgame000000000000000000000",
    startingFen: INITIAL,
    startPly: 0,
    moves: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6",
    plyCount: 6,
    chessPositionId: null,
    positionName: null,
    color: "b" as const,
    opponentName: "tal_fan_77",
    comparisonFacts: null,
    whitePlayerName: null,
    blackPlayerName: null,
    whiteLegendName: null,
    blackLegendName: null,
  };

  it("the position before ply n; the viewer's colour; the label of the move about to be played", () => {
    const ctx = PracticeContextDTO.parse(gameContextOf(base, 3));
    assert.equal(ctx.fen, "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    assert.deepEqual(
      { s: ctx.sideToMove, h: ctx.humanColor, from: ctx.fromLabel, t: ctx.title, b: ctx.backHref, c: ctx.compareHref },
      { s: "b", h: "b", from: "Practice · from move 2", t: "Your game vs tal_fan_77", b: "/review/cgame000000000000000000000", c: null },
    );
    assert.equal(gameContextOf(base, undefined).fen, INITIAL, "no ply = the game's start");
  });

  it("ply out of [0, plyCount) → 400 on ply", () => {
    for (const ply of [6, 7, -1]) {
      assert.throws(() => gameContextOf(base, ply), (e) => isApiError(e) && e.code === "validation_failed" && !!e.fields?.ply, String(ply));
    }
  });

  it("a legend game: You vs {Legend}, Compare, and the legend's move as the plan line at the divergence", () => {
    const legend = {
      ...base,
      startingFen: OPERA_START,
      startPly: 18,
      moves: "c3b5 c6b5 c4b5 b8d7 b5a4 a8b8",
      plyCount: 6,
      chessPositionId: 5n,
      color: "w" as const,
      positionName: "Opera Game",
      whitePlayerName: "Paul Morphy",
      comparisonFacts: {
        v: 1,
        side: "w",
        historicalName: "Morphy",
        startPly: 18,
        comparedPlies: 5,
        matchedPlies: 4,
        divergencePly: 4,
        divergenceBy: "user",
        userUci: "b5a4",
        userSan: "Ba4",
        legendUci: "e1c1",
        legendSan: "O-O-O",
        legendResult: "white_won",
        legendTotalMoves: 17,
        userLineUci: "c3b5 c6b5 c4b5 b8d7 b5a4",
        legendLineUci: "c3b5 c6b5 c4b5 b8d7 e1c1",
        evalAtDivergence: null,
      },
    };
    const at = PracticeContextDTO.parse(gameContextOf(legend, 4));
    assert.deepEqual(
      { t: at.title, c: at.compareHref, p: at.planLine, from: at.fromLabel },
      { t: "You vs Morphy", c: "/review/cgame000000000000000000000/legend", p: "Morphy played 12.O-O-O here.", from: "Practice · from move 12" },
    );
    assert.equal(gameContextOf(legend, 2).planLine, null, "only at the divergence");
    const noFacts = gameContextOf({ ...legend, comparisonFacts: null }, 4);
    assert.deepEqual({ t: noFacts.title, p: noFacts.planLine }, { t: "You vs Morphy", p: null });
  });

  it("one statement per source; finished games only; the viewer's row (admins: the member row)", async () => {
    const sql = practiceGameSql({ id: 3n, role: "user" }, "cgame000000000000000000000");
    assert.match(textOf(sql), /g\.status IN \('COMPLETED', 'ABORTED'\)/);
    assert.match(textOf(sql), /p\."userId" = \? OR \?::boolean/);
    assert.ok(sql.values.includes(false), "not an admin");
    const seen: string[] = [];
    const db: GamesDb = {
      $queryRaw: async <T>(s: Prisma.Sql) => {
        seen.push(textOf(s));
        return [] as T;
      },
      $executeRaw: async () => 0,
    };
    await assert.rejects(() => getPracticeContext(db, { id: 3n, role: "user" }, { source: "game", game: "cx", ply: 1 }), (e) => isApiError(e) && e.code === "not_found");
    await assert.rejects(() => getPracticeContext(db, { id: 3n, role: "user" }, { source: "position", position: "cx" }), (e) => isApiError(e) && e.code === "not_found");
    assert.equal(seen.length, 2);
    await getPracticeContext(db, { id: 3n, role: "user" }, { source: "fen", fen: INITIAL });
    assert.equal(seen.length, 2, "a FEN needs no statement");
  });
});
