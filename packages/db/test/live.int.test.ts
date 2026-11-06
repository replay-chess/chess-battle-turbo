/**
 * @repo/db live store and creators against a real Postgres (phase-02 plan 6.6, WP-A acceptance): create and join,
 * session load, checkpoint guards, the one-statement finish (idempotent, counts once, bumps gamesVersion once),
 * abort, rematch, the restore list and the stale sweeps. Skipped unless TEST_DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, type PrismaClient } from "#generated";
import { createPrismaClient } from "../src/client";
import { INITIAL_FEN, createLiveGame, joinLiveGame } from "../src/games";
import {
  abortGame,
  checkpointGame,
  createRematch,
  finishGame,
  loadLiveGame,
  restoreList,
  staleBotSweepSql,
  staleSweep,
} from "../src/live";
import {
  OPERA_FINAL_FEN,
  OPERA_UCI,
  REALTIME_URL,
  TEST_URL,
  assertLocalTestUrl,
  gameRow,
  makeUser,
  playerRows,
  stats,
  type TestUser,
} from "./helpers";

const LEGEND_FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
const in1h = () => new Date(Date.now() + 3600_000);

describe("@repo/db live store (Postgres)", { skip: TEST_URL ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  /** The socket's client (role replay_realtime when TEST_REALTIME_DATABASE_URL is set). */
  let rt: PrismaClient;
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;

  before(async () => {
    assertLocalTestUrl(TEST_URL!);
    db = createPrismaClient({ datasourceUrl: TEST_URL });
    assertLocalTestUrl(REALTIME_URL!);
    rt = createPrismaClient({ datasourceUrl: REALTIME_URL });
    a = await makeUser(db, "alice");
    b = await makeUser(db, "bob");
    c = await makeUser(db, "carol");
  });

  after(async () => {
    await db.$disconnect();
    await rt.$disconnect();
  });

  async function friendGame(opts: { fen?: string; tc?: [number, number]; white?: TestUser } = {}) {
    const creator = opts.white ?? a;
    const created = await createLiveGame(db, {
      mode: "FRIEND",
      creatorId: creator.id,
      white: { userId: creator.id, name: creator.name, rating: 1500 },
      black: null,
      startingFen: opts.fen ?? INITIAL_FEN,
      initialTimeSeconds: opts.tc?.[0] ?? 300,
      incrementSeconds: opts.tc?.[1] ?? 3,
      meta: { v: 1, header: "C41 · Philidor", prefixSan: [], prefixStartMoveNo: 1, position: null },
      gameData: { gameMode: "friend", creatorColor: "white" },
      expiresAt: in1h(),
    });
    return created;
  }

  async function playingGame(white: TestUser, black: TestUser, extra: { tournamentId?: bigint } = {}) {
    return createLiveGame(db, {
      mode: extra.tournamentId ? "TOURNAMENT" : "ONLINE",
      creatorId: white.id,
      white: { userId: white.id, name: white.name, rating: 1400 },
      black: { userId: black.id, name: black.name, rating: 1600, title: "FM" },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 180,
      incrementSeconds: 2,
      tournamentId: extra.tournamentId ?? null,
      expiresAt: in1h(),
    });
  }

  it("createLiveGame (friend, waiting): typed columns, snapshot, one game_players row", async () => {
    const g = await friendGame({ fen: LEGEND_FEN });
    assert.equal(g.players, 1);
    assert.match(g.ref, /^c[a-z0-9]{20,31}$/);
    const row = await gameRow(db, g.id);
    assert.equal(row.status, "WAITING_FOR_OPPONENT");
    assert.equal(row.mode, "FRIEND");
    assert.equal(row.phase, "WAITING");
    assert.equal(row.timeClass, "BLITZ");
    assert.equal(row.studySeconds, 30);
    assert.equal(row.startPly, 4);
    assert.equal(row.whitePlayerId, a.id);
    assert.equal(row.blackPlayerId, null);
    assert.equal(row.whiteName, a.name);
    assert.equal(row.whiteTimeMs, 300_000);
    assert.equal(row.startedAt, null);
    const players = await playerRows(db, g.id);
    assert.equal(players.length, 1);
    assert.deepEqual(
      { color: players[0]!.color, mode: players[0]!.mode, opp: players[0]!.opponentName, before: players[0]!.ratingBefore },
      { color: "w", mode: "FRIEND", opp: "", before: 1500 },
    );
  });

  it("joinLiveGame fills the empty colour; two concurrent joins → exactly one wins", async () => {
    const g = await friendGame();
    const [r1, r2] = await Promise.all([
      joinLiveGame(db, { ref: g.ref, me: { userId: b.id, name: b.name, rating: 1600 } }),
      joinLiveGame(db, { ref: g.ref, me: { userId: c.id, name: c.name, rating: 1700 } }),
    ]);
    const winners = [r1, r2].filter(Boolean);
    assert.equal(winners.length, 1, "one join succeeds, the other gets null (→ 409 already_started)");
    assert.equal(winners[0]!.color, "b");
    const row = await gameRow(db, g.id);
    assert.equal(row.status, "IN_PROGRESS");
    const joiner = row.blackPlayerId === b.id ? b : c;
    assert.equal(row.blackName, joiner.name);
    const players = await playerRows(db, g.id);
    assert.equal(players.length, 2);
    const creatorRow = players.find((p) => p.userId === a.id)!;
    assert.equal(creatorRow.opponentUserId, joiner.id);
    assert.equal(creatorRow.opponentName, joiner.name);
    const joinerRow = players.find((p) => p.userId === joiner.id)!;
    assert.equal(joinerRow.opponentName, a.name);
    assert.equal(joinerRow.opponentRating, 1500);
    // Own game and an already started game are refused.
    assert.equal(await joinLiveGame(db, { ref: g.ref, me: { userId: a.id, name: a.name } }), null);
  });

  it("the creator cannot join their own waiting game", async () => {
    const g = await friendGame();
    assert.equal(await joinLiveGame(db, { ref: g.ref, me: { userId: a.id, name: a.name } }), null);
  });

  it("loadLiveGame returns the session record in one statement", async () => {
    const g = await playingGame(a, b);
    const rec = await loadLiveGame(rt, g.ref);
    assert.ok(rec);
    assert.equal(rec.mode, "ONLINE");
    assert.equal(rec.white?.ref, a.ref);
    assert.equal(rec.black?.ref, b.ref);
    assert.equal(rec.black?.title, "FM");
    assert.equal(rec.black?.rating, 1600);
    assert.equal(rec.timeClass, "BLITZ");
    assert.deepEqual(rec.moveClocksMs, []);
    assert.equal(rec.meta?.v, 1);
    assert.equal(await loadLiveGame(rt, "cnosuchgame0000000000000"), null);
  });

  it("checkpoint: idempotent overwrite, `plyCount <=` guard, same-ply freeze allowed", async () => {
    const g = await playingGame(a, b);
    const at = new Date();
    const cp = (ply: number, moves: string, extra: Partial<Parameters<typeof checkpointGame>[1]> = {}) =>
      checkpointGame(rt, {
        gameId: g.id,
        moves,
        clocksMs: Array.from({ length: ply }, (_, i) => 180_000 - i * 100),
        plyCount: ply,
        fen: "x",
        whiteTimeMs: 170_000,
        blackTimeMs: 171_000,
        clockRunning: ply % 2 === 0 ? "w" : "b",
        phase: "playing",
        phaseEndsAt: null,
        lastMoveAt: at,
        ...extra,
      });
    assert.equal((await cp(2, "e2e4 e7e5")).applied, true);
    assert.equal((await cp(4, "e2e4 e7e5 g1f3 b8c6")).applied, true);
    assert.equal((await cp(2, "e2e4 e7e5")).applied, false, "an older checkpoint is a no-op");
    assert.equal((await cp(4, "e2e4 e7e5 g1f3 b8c6", { clockRunning: null })).applied, true, "same ply (drain freeze)");
    const row = await gameRow(db, g.id);
    assert.equal(row.moves, "e2e4 e7e5 g1f3 b8c6");
    assert.equal(row.plyCount, 4);
    assert.equal(row.clockRunning, null);
    assert.equal(row.phase, "PLAYING");
    assert.deepEqual(row.moveClocksMs, [180000, 179900, 179800, 179700]);
    assert.equal((row.lastMoveAt as Date).getTime(), at.getTime(), "timestamps round-trip in UTC");
  });

  it("finish: one statement stores every ply + PGN, counts stats once, bumps gamesVersion once; a retry is a no-op", async () => {
    const w = await makeUser(db, "w");
    const bl = await makeUser(db, "b");
    const g = await playingGame(w, bl);
    const input = {
      gameId: g.id,
      moves: OPERA_UCI,
      clocksMs: Array.from({ length: 33 }, (_, i) => 180_000 - i * 1000),
      plyCount: 33,
      fen: OPERA_FINAL_FEN,
      whiteTimeMs: 150_000,
      blackTimeMs: 149_000,
      method: "checkmate" as const,
      winner: "w" as const,
      pgn: "[Event \"x\"]\n\n1. e4 e5 … 17. Rd8# 1-0",
      endedAt: new Date(),
      metaPatch: { drawOffers: { w: 1, b: 0 } },
    };
    const first = await finishGame(rt, input);
    assert.equal(first.finished, true);
    assert.equal(first.players, 2);
    const second = await finishGame(rt, input);
    assert.equal(second.finished, false);
    assert.equal(second.conflict, false, "a retry after a lost response counts as success");
    const third = await finishGame(rt, { ...input, method: "resignation", winner: "b" });
    assert.equal(third.conflict, true, "a different end is a conflict; the DB wins");

    const row = await gameRow(db, g.id);
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.phase, "ENDED");
    assert.equal(row.endMethod, "CHECKMATE");
    assert.equal(row.outcome, "WHITE");
    assert.equal(row.result, "CREATOR_WON");
    assert.equal(row.winnerId, w.id);
    assert.equal((row.moves as string).split(" ").length, 33, "the mating move is stored (F-07)");
    assert.equal(row.plyCount, 33);
    assert.equal(row.creatorTimeRemaining, 150);
    assert.equal(row.opponentTimeRemaining, 149);
    assert.ok((row.pgn as string).includes("Rd8#"));
    assert.equal((row.meta as { drawOffers: { w: number } }).drawOffers.w, 1);
    assert.equal((row.meta as { header: string }).header, "", "creation meta kept (merge)");

    const players = await playerRows(db, g.id);
    assert.deepEqual(
      players.map((p) => [p.color, p.result]),
      [
        ["w", "WIN"],
        ["b", "LOSS"],
      ],
    );
    assert.ok(players.every((p) => p.endedAt));
    assert.deepEqual(await stats(db, w.id), { total: 1, won: 1, lost: 0, drawn: 0, streak: 1, version: 1 });
    assert.deepEqual(await stats(db, bl.id), { total: 1, won: 0, lost: 1, drawn: 0, streak: 0, version: 1 });
  });

  it("finish: draws, timeouts and the legacy result follow the winner's colour, not the creator flag", async () => {
    const w = await makeUser(db, "w");
    const bl = await makeUser(db, "b");
    // Creator plays Black here.
    const g = await createLiveGame(db, {
      mode: "ONLINE",
      creatorId: bl.id,
      white: { userId: w.id, name: w.name },
      black: { userId: bl.id, name: bl.name },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 60,
      incrementSeconds: 0,
      expiresAt: in1h(),
    });
    const r = await finishGame(rt, {
      gameId: g.id,
      moves: "e2e4 e7e5",
      clocksMs: [59_000, 58_000],
      plyCount: 2,
      fen: "f",
      whiteTimeMs: 0,
      blackTimeMs: 58_000,
      method: "timeout",
      winner: "b",
      pgn: null,
      endedAt: new Date(),
    });
    assert.equal(r.finished, true);
    const row = await gameRow(db, g.id);
    assert.equal(row.result, "OPPONENT_TIMEOUT", "creator (Black) won on time");
    assert.equal(row.winnerId, bl.id);
    assert.equal(row.creatorTimeRemaining, 58);
    assert.equal(row.opponentTimeRemaining, 0);

    const d = await playingGame(w, bl);
    await finishGame(rt, {
      gameId: d.id,
      moves: "",
      clocksMs: [],
      plyCount: 0,
      fen: INITIAL_FEN,
      whiteTimeMs: 1,
      blackTimeMs: 0,
      method: "timeout_vs_insufficient",
      winner: null,
      pgn: null,
      endedAt: new Date(),
    });
    const drow = await gameRow(db, d.id);
    assert.deepEqual([drow.outcome, drow.result, drow.winnerId], ["DRAW", "DRAW", null]);
    assert.deepEqual(
      (await playerRows(db, d.id)).map((p) => p.result),
      ["DRAW", "DRAW"],
    );
    assert.equal((await stats(db, w.id)).drawn, 1);
  });

  it("finish: tournament standings move once (legacy arena)", async () => {
    const w = await makeUser(db, "tw");
    const bl = await makeUser(db, "tb");
    const t = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO tournaments ("referenceId", name, mode, "initialTimeSeconds", "incrementSeconds", "durationMinutes",
                               "createdByUserId", "updatedAt")
      VALUES (${`t${w.ref}`}, 'Arena', 'FREE', 180, 2, 30, ${w.id}, now()) RETURNING id`);
    const tid = t[0]!.id;
    for (const u of [w, bl]) {
      await db.$executeRaw(Prisma.sql`
        INSERT INTO tournament_participants ("referenceId", "tournamentId", "userId", "updatedAt")
        VALUES (${`p${u.ref}`}, ${tid}, ${u.id}, now())`);
    }
    const g = await playingGame(w, bl, { tournamentId: tid });
    const input = {
      gameId: g.id,
      moves: "e2e4",
      clocksMs: [1],
      plyCount: 1,
      fen: "f",
      whiteTimeMs: 1,
      blackTimeMs: 1,
      method: "agreement" as const,
      winner: null,
      pgn: null,
      endedAt: new Date(),
    };
    assert.equal((await finishGame(rt, input)).standings, 2);
    assert.equal((await finishGame(rt, input)).finished, false);
    const pts = await db.$queryRaw<{ points: string; draws: number }[]>(Prisma.sql`
      SELECT points::text AS points, draws FROM tournament_participants WHERE "tournamentId" = ${tid} ORDER BY "userId"`);
    assert.deepEqual(
      pts.map((p) => [p.points, p.draws]),
      [
        ["0.5", 1],
        ["0.5", 1],
      ],
    );
  });

  it("abort: ABORTED, no stats, game_players ABORTED, meta.abortedBy, gamesVersion bumped; idempotent", async () => {
    const w = await makeUser(db, "aw");
    const bl = await makeUser(db, "ab");
    const g = await playingGame(w, bl);
    const r = await abortGame(rt, { gameId: g.id, abortedBy: "timeout", endedAt: new Date(), moves: "e2e4", plyCount: 1 });
    assert.equal(r.aborted, true);
    assert.equal(r.players, 2);
    const again = await abortGame(rt, { gameId: g.id, abortedBy: "w", endedAt: new Date() });
    assert.deepEqual(again, { aborted: false, players: 0, storedStatus: "ABORTED" });
    const row = await gameRow(db, g.id);
    assert.deepEqual([row.status, row.endMethod, row.outcome, row.result, row.phase], [
      "ABORTED",
      "ABORTED",
      "NONE",
      null,
      "ENDED",
    ]);
    assert.equal(row.moves, "e2e4");
    assert.equal((row.meta as { abortedBy: string }).abortedBy, "timeout");
    assert.deepEqual(
      (await playerRows(db, g.id)).map((p) => p.result),
      ["ABORTED", "ABORTED"],
    );
    assert.deepEqual(await stats(db, w.id), { total: 0, won: 0, lost: 0, drawn: 0, streak: 0, version: 1 });
  });

  it("rematch: colours swapped, rematchOfId, WAITING phase, both game_players rows; a retry returns the same game", async () => {
    const w = await makeUser(db, "rw");
    const bl = await makeUser(db, "rb");
    const parent = await createLiveGame(db, {
      mode: "FRIEND",
      creatorId: w.id,
      white: { userId: w.id, name: w.name, rating: 1200 },
      black: { userId: bl.id, name: bl.name, rating: 1300 },
      startingFen: LEGEND_FEN,
      initialTimeSeconds: 300,
      incrementSeconds: 3,
      meta: { v: 1, header: "Legend", prefixSan: ["e4", "e5", "Nf3", "Nc6"], prefixStartMoveNo: 1, position: null, assists: { hints: 2, undos: 1 } },
      expiresAt: in1h(),
    });
    assert.equal(await createRematch(rt, { parentId: parent.id, offererId: bl.id, accepterId: w.id }), null, "parent not finished");
    await finishGame(rt, {
      gameId: parent.id, moves: "", clocksMs: [], plyCount: 0, fen: LEGEND_FEN, whiteTimeMs: 1, blackTimeMs: 1,
      method: "resignation", winner: "b", pgn: null, endedAt: new Date(),
    });
    const r = await createRematch(rt, { parentId: parent.id, offererId: bl.id, accepterId: w.id });
    assert.ok(r);
    assert.equal(r.created, true);
    assert.equal(r.whitePlayerId, bl.id);
    assert.equal(r.blackPlayerId, w.id);
    const row = await gameRow(db, r.id);
    assert.deepEqual([row.status, row.phase, row.mode, row.studySeconds, row.rematchOfId], [
      "IN_PROGRESS",
      "WAITING",
      "FRIEND",
      30,
      parent.id,
    ]);
    assert.deepEqual([row.whiteName, row.whiteRating, row.blackName, row.blackRating], [bl.name, 1300, w.name, 1200]);
    assert.deepEqual((row.meta as { assists: unknown }).assists, { hints: 0, undos: 0 });
    assert.equal((row.meta as { header: string }).header, "Legend");
    // regression (WP-D request A): the child's load carries the parent's ref, so GameState.rematchOf survives a restart.
    assert.equal((await loadLiveGame(rt, r.ref))?.rematchOfRef, parent.ref);
    assert.equal((await loadLiveGame(rt, parent.ref))?.rematchOfRef, null);
    const players = await playerRows(db, r.id);
    assert.deepEqual(
      players.map((p) => [p.color, p.userId, p.opponentUserId, p.opponentName]),
      [
        ["w", bl.id, w.id, w.name],
        ["b", w.id, bl.id, bl.name],
      ],
    );
    const again = await createRematch(rt, { parentId: parent.id, offererId: bl.id, accepterId: w.id });
    assert.deepEqual([again?.id, again?.created], [r.id, false]);
  });

  it("restore list and stale sweep (Q7: abort < 2 plies after 30 min, abandon after 2 h)", async () => {
    const w = await makeUser(db, "sw");
    const bl = await makeUser(db, "sb");
    const fresh = await playingGame(w, bl);
    const staleShort = await playingGame(w, bl);
    const staleLongRecent = await playingGame(w, bl);
    const staleLong = await playingGame(w, bl);
    const held = await playingGame(w, bl);
    const age = async (id: bigint, minutes: number, plies: number, fen: string) =>
      db.$executeRaw(Prisma.sql`
        UPDATE games SET "lastMoveAt" = now() - (${minutes}::int * interval '1 minute'), "plyCount" = ${plies},
               moves = ${plies === 0 ? "" : "e2e4 e7e5 g1f3".split(" ").slice(0, plies).join(" ")}, fen = ${fen}
         WHERE id = ${id}`);
    await age(staleShort.id, 31, 1, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
    await age(staleLongRecent.id, 60, 3, "f b - - 0 1");
    await age(staleLong.id, 121, 3, "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    await age(held.id, 500, 3, "f b - - 0 1");

    const refs = await restoreList(db);
    assert.ok(refs.includes(fresh.ref));
    assert.ok(refs.includes(staleLongRecent.ref), "60 min old: inside the 2 h window");
    assert.ok(!refs.includes(staleLong.ref), "121 min old: outside the 2 h window");

    const swept = await staleSweep(rt, { liveRefs: [held.ref], limit: 500, pgnFor: (_row, loser) => `loser ${loser}` });
    assert.ok(swept.aborted.includes(staleShort.ref));
    assert.ok(swept.abandoned.includes(staleLong.ref));
    for (const ref of [fresh.ref, staleLongRecent.ref, held.ref]) {
      assert.ok(!swept.aborted.includes(ref) && !swept.abandoned.includes(ref), ref);
    }
    const ab = await gameRow(db, staleShort.id);
    assert.deepEqual([ab.status, (ab.meta as { abortedBy: string }).abortedBy], ["ABORTED", "stale"]);
    const an = await gameRow(db, staleLong.id);
    assert.deepEqual([an.status, an.endMethod, an.outcome, an.pgn], ["COMPLETED", "ABANDONED", "WHITE", "loser b"]);
  });

  it("daily bot sweep aborts BOT games idle for 7 days and bumps gamesVersion once per member", async () => {
    const u = await makeUser(db, "bot");
    const g = await createLiveGame(db, {
      mode: "BOT",
      creatorId: u.id,
      white: { userId: u.id, name: u.name, rating: 1100 },
      black: null,
      bot: { elo: 1200 },
      startingFen: INITIAL_FEN,
      initialTimeSeconds: 600,
      incrementSeconds: 0,
      expiresAt: in1h(),
    });
    const row0 = await gameRow(db, g.id);
    assert.deepEqual([row0.status, row0.phase, row0.blackName, row0.blackRating, row0.studySeconds], [
      "IN_PROGRESS",
      "PLAYING",
      "Engine 1200",
      1200,
      0,
    ]);
    assert.equal((await playerRows(db, g.id))[0]!.opponentName, "Engine 1200");
    await db.$executeRaw(Prisma.sql`UPDATE games SET "lastMoveAt" = now() - interval '8 days' WHERE id = ${g.id}`);
    const r = await db.$queryRaw<{ aborted: number }[]>(staleBotSweepSql());
    assert.ok(r[0]!.aborted >= 1);
    assert.equal((await gameRow(db, g.id)).status, "ABORTED");
    assert.equal((await stats(db, u.id)).version, 1);
  });
});
