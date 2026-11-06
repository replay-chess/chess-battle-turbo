// lib/games/create-bot-game.server.ts + start.server.ts (phase-02 plan §12.1): colour resolution (auto for opening,
// legend, position and initial), default Elo, startPly, and the meta header / prefix / position card from fixtures.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameCreateBody } from "@repo/contracts/http/games";
import { startPlyOf } from "@repo/db/games";
import { ApiError } from "@/lib/api/api-error";
import {
  assertLegalFen,
  createBotGame,
  resolveColor,
  startFromInitial,
  startFromOpening,
  startFromParent,
  startFromPosition,
  type CreateBotGameDb,
} from "./create-bot-game.server";
import {
  afterLabel,
  legendSideOf,
  metaForOpening,
  metaForPosition,
  openingSide,
  prefixFromPgn,
  ratingFor,
  sideOf,
  type StartOpening,
  type StartPosition,
} from "./start.server";

const OPERA_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
const OPERA_PGN = "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5";
const OPERA_FULL = `${OPERA_PGN} 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const opera: StartPosition = {
  id: 7n,
  referenceId: "cposition0000000000000000",
  fen: OPERA_FEN,
  sideToMove: "white",
  pgn: OPERA_PGN,
  moveNumber: 10,
  whitePlayerName: "Paul Morphy",
  blackPlayerName: "Duke Karl of Brunswick and Count Isouard",
  whitePlayerId: 11n,
  blackPlayerId: null,
  tournamentName: "Paris Opera",
  eventDate: new Date("1858-11-02T00:00:00Z"),
  positionType: "attack",
};

const italian: StartOpening = {
  id: 3n,
  referenceId: "copening00000000000000000",
  eco: "C50",
  name: "Italian Game",
  pgn: "1. e4 e5 2. Nf3 Nc6 3. Bc4",
  fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
  sideToMove: "black",
  moveCount: 5,
};

describe("start rules", () => {
  it("prefix: the PGN moves before the start (a full-game PGN is cut at the position)", () => {
    for (const pgn of [OPERA_PGN, OPERA_FULL]) {
      const p = prefixFromPgn(pgn, OPERA_FEN);
      assert.equal(p.sans.length, 18);
      assert.equal(p.sans[0], "e4");
      assert.equal(p.sans.at(-1), "b5");
      assert.equal(p.startMoveNo, 1);
      assert.equal(p.last, "9…b5");
      assert.equal(afterLabel(p), "after 9…b5");
    }
  });

  it("prefix: a PGN that never reaches the start gives none; garbage gives none", () => {
    assert.deepEqual(prefixFromPgn("1.d4 d5 2.c4", OPERA_FEN), { sans: [], startMoveNo: 1, last: null });
    assert.deepEqual(prefixFromPgn("not a pgn", OPERA_FEN).sans, []);
    assert.deepEqual(prefixFromPgn(null, OPERA_FEN).sans, []);
  });

  it("prefix keeps the last 120 SAN with the right first move number", () => {
    // 128 knight shuffles (Nf3 Nf6 Ng1 Ng8 ×32) then 65.e4: 129 plies before the start.
    const sans: string[] = [];
    for (let i = 0; i < 32; i++) sans.push("Nf3", "Nf6", "Ng1", "Ng8");
    sans.push("e4");
    const pgn = sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(" ");
    const start = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 65";
    const p = prefixFromPgn(pgn, start);
    assert.equal(p.sans.length, 120);
    assert.equal(p.sans.at(-1), "e4");
    assert.equal(p.startMoveNo, 5); // 9 plies dropped: the first kept SAN is Black's 5th move
    assert.equal(p.last, "65.e4");
  });

  it("legend side, opening side, side strings and displayed ratings", () => {
    assert.equal(legendSideOf(opera, 11n), "w");
    assert.equal(legendSideOf({ whitePlayerId: null, blackPlayerId: 4n }, 4n), "b");
    assert.equal(legendSideOf({ whitePlayerId: null, blackPlayerId: null }), null);
    assert.equal(openingSide(italian), "w"); // Black to move → White made the last move
    assert.equal(sideOf("Black"), "b");
    assert.equal(sideOf("x"), null);
    const profile = { bulletRating: 900, blitzRating: 1487, rapidRating: 1620 };
    assert.equal(ratingFor(profile, "BULLET"), 900);
    assert.equal(ratingFor(profile, "BLITZ"), 1487);
    assert.equal(ratingFor(profile, "CLASSICAL"), 1620);
    assert.equal(ratingFor(null, "RAPID"), null);
  });

  it("meta: legend header, position card and prefix; opening header and prefix", () => {
    const m = metaForPosition(opera, "w");
    assert.equal(m.header, "Paul Morphy vs Duke Karl of Brunswick and Count Isouard 1858");
    assert.ok(m.header.length <= 80);
    assert.equal(m.prefixSan.length, 18);
    assert.deepEqual(m.position, {
      name: "Paul Morphy vs Duke Karl of Brunswick and Count Isouard",
      event: "Paris Opera",
      year: 1858,
      afterLabel: "after 9…b5",
      legendSide: "w",
    });
    const o = metaForOpening(italian);
    assert.equal(o.header, "C50 · Italian Game");
    assert.deepEqual(o.prefixSan, ["e4", "e5", "Nf3", "Nc6", "Bc4"]);
    assert.equal(o.position, null);
    const endgame = metaForPosition({ ...opera, whitePlayerName: null, blackPlayerName: null, pgn: null, positionType: "Endgame" }, null);
    assert.equal(endgame.header, "Endgame · move 10");
    assert.equal(endgame.position, null);
    // regression: FIX-A — seeded opening positions name both players "Various": the opening name, not "Various vs Various".
    const various = metaForPosition(
      { ...opera, whitePlayerName: "Various", blackPlayerName: "Various", tournamentName: "Open Game", positionType: "opening", pgn: "1.e4 e5 2.Nf3 Nc6" },
      null,
    );
    assert.equal(various.header, "Open Game");
    assert.equal(various.position?.name, "Open Game");
    assert.equal(various.position?.legendSide, null);
  });
});

describe("colour resolution", () => {
  it("auto: opening → the opening's side; legend → the legend's side; position → side to move; initial → White", () => {
    assert.equal(startFromOpening(italian).autoSide, "w");
    assert.equal(startFromPosition({ ...opera, whitePlayerId: null, blackPlayerId: 11n }, 11n).autoSide, "b");
    assert.equal(startFromPosition({ ...opera, sideToMove: "black" }).autoSide, "b");
    assert.equal(startFromInitial().autoSide, "w");
    assert.equal(resolveColor("auto", "b", "new", null), "b");
  });

  it("explicit, random, rematch (swapped) and restart (same)", () => {
    assert.equal(resolveColor("w", "b", "new", null), "w");
    assert.equal(resolveColor("random", "w", "new", null, () => 0.9), "b");
    assert.equal(resolveColor("random", "w", "new", null, () => 0.1), "w");
    assert.equal(resolveColor("w", "w", "rematch", { humanSide: "w" }), "b");
    assert.equal(resolveColor("b", "w", "restart", { humanSide: "w" }), "w");
  });

  it("startPly follows the FEN; the parent's start is reused for rematch and restart", () => {
    assert.equal(startPlyOf(OPERA_FEN), 18);
    assert.equal(startPlyOf(italian.fen), 5);
    const parent = startFromParent({
      id: 1n,
      status: "COMPLETED",
      mode: "BOT",
      plyCount: 30,
      humanSide: "b",
      botElo: 1400,
      startingFen: OPERA_FEN,
      chessPositionId: 7n,
      openingId: null,
      meta: { header: "H", prefixSan: ["e4"], prefixStartMoveNo: 1, position: null, rev: 9 },
    });
    assert.equal(parent.fen, OPERA_FEN);
    assert.equal(parent.chessPositionId, 7n);
    assert.deepEqual(parent.meta, { v: 1, header: "H", prefixSan: ["e4"], prefixStartMoveNo: 1, position: null });
  });

  it("a FEN chess.js rejects is 422 illegal_position", () => {
    assert.throws(() => assertLegalFen("not a fen"), (e: unknown) => e instanceof ApiError && e.code === "illegal_position");
    assert.doesNotThrow(() => assertLegalFen(OPERA_FEN));
  });
});

describe("createBotGame (fake client)", () => {
  function fakeDb(profile: { bulletRating: number | null; blitzRating: number | null; rapidRating: number | null } | null) {
    const sql: string[] = [];
    let created: { ref: string; text: string; values: unknown[] } | null = null;
    // The service sends every statement as (text, ...values) (rawDb, snapshot.server.ts).
    const db = {
      $queryRawUnsafe: (text: string, ...values: unknown[]) => {
        sql.push(text);
        if (text.includes("INSERT INTO games")) {
          created = { ref: values[0] as string, text, values };
          return Promise.resolve([{ id: 99n, ref: values[0], players: 1 }]);
        }
        if (text.includes("LEFT JOIN games r")) {
          const v = created!.values;
          const white = v[8] as bigint | null;
          return Promise.resolve([
            {
              id: 99n,
              referenceId: created!.ref,
              status: "IN_PROGRESS",
              mode: "BOT",
              rated: false,
              timeClass: "RAPID",
              creatorId: 5n,
              opponentId: 2n,
              whitePlayerId: white,
              blackPlayerId: v[9] as bigint | null,
              botElo: v[7] as number,
              chessPositionId: null,
              openingId: null,
              startingFen: v[10] as string,
              startPly: 0,
              studySeconds: 0,
              moves: "",
              moveClocksMs: [],
              plyCount: 0,
              fen: v[10] as string,
              initialTimeSeconds: 600,
              incrementSeconds: 0,
              whiteTimeMs: 600000,
              blackTimeMs: 600000,
              clockRunning: null,
              phase: "PLAYING",
              phaseEndsAt: null,
              lastMoveAt: new Date(0),
              endMethod: null,
              outcome: null,
              startedAt: new Date(0),
              completedAt: null,
              createdAt: new Date(0),
              updatedAt: new Date(0),
              meta: { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null, rev: 0 },
              whiteName: white ? "Ann" : `Engine ${v[7]}`,
              blackName: white ? `Engine ${v[7]}` : "Ann",
              whiteRating: null,
              blackRating: null,
              rematchOfRef: null,
              wRef: white ? "cviewer00000000000000000000" : null,
              wName: white ? "Ann" : null,
              wAvatar: null,
              bRef: white ? null : "cviewer00000000000000000000",
              bName: white ? null : "Ann",
              bAvatar: null,
            },
          ]);
        }
        return Promise.resolve([]);
      },
      $executeRawUnsafe: () => Promise.resolve(0),
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
      chessComProfile: { findUnique: async () => profile },
      user: { findUnique: async () => ({ id: 2n }) },
      chessPosition: { findUnique: async () => null, update: () => Promise.resolve(null) },
      opening: { findFirst: async () => null },
      legend: { findUnique: async () => null },
    };
    return { db: db as unknown as CreateBotGameDb, sql };
  }
  const viewer = { id: 5n, user: { name: "Ann" } };
  const body = (b: Partial<GameCreateBody>): GameCreateBody => ({
    mode: "BOT",
    start: { kind: "initial" },
    color: "auto",
    tc: { initialSeconds: 600, incrementSeconds: 0 },
    reason: "new",
    ...b,
  });

  it("default Elo: the viewer's rating for the time class, rounded to 100 and clamped (else 1200)", async () => {
    const rapid = await createBotGame(fakeDb({ bulletRating: null, blitzRating: 1487, rapidRating: 1651 }).db, viewer, body({}), new Date(0));
    assert.equal(rapid.botElo, 1700);
    const blitz = await createBotGame(
      fakeDb({ bulletRating: null, blitzRating: 1487, rapidRating: 1651 }).db,
      viewer,
      body({ tc: { initialSeconds: 180, incrementSeconds: 2 } }),
      new Date(0),
    );
    assert.equal(blitz.botElo, 1500);
    const none = await createBotGame(fakeDb(null).db, viewer, body({}), new Date(0));
    assert.equal(none.botElo, 1200);
    const high = await createBotGame(fakeDb({ bulletRating: null, blitzRating: null, rapidRating: 2900 }).db, viewer, body({}), new Date(0));
    assert.equal(high.botElo, 2200);
    const given = await createBotGame(fakeDb(null).db, viewer, body({ botElo: 600 }), new Date(0));
    assert.equal(given.botElo, 600);
  });

  it("writes one insert (game + game_players), then reads the snapshot back; colour b gives the bot White", async () => {
    const { db, sql } = fakeDb(null);
    const out = await createBotGame(db, viewer, body({ color: "b" }), new Date(0));
    assert.equal(out.color, "b");
    assert.equal(out.snapshot.mode, "BOT");
    assert.deepEqual(out.snapshot.you, { role: "player", color: "b" });
    assert.equal(out.snapshot.players.w.isBot, true);
    assert.equal(sql.filter((s) => s.includes("INSERT INTO games")).length, 1);
    assert.ok(sql.some((s) => s.includes("INSERT INTO game_players")));
  });

  it("LEGEND_BOT is 400 validation_failed {reason: mode_not_available} until P8", async () => {
    await assert.rejects(
      createBotGame(fakeDb(null).db, viewer, body({ mode: "LEGEND_BOT" }), new Date(0)),
      (e: unknown) => e instanceof ApiError && e.code === "validation_failed" && e.details?.reason === "mode_not_available",
    );
  });
});
