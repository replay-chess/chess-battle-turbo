/**
 * The P2 game routes against a real Postgres after `prisma migrate deploy` (phase-02 plan §12.5): POST /api/games
 * (201, Idempotency-Key replay, reuse → 422, mode_not_available, unknown start → 404), GET /api/games/[ref] (player,
 * hidden bot game, spectator projection, private-etag on finished games), checkpoint (rev guard, rev_gap, illegal,
 * non-player), complete (genuine mate, forged mate, stored replay, stats and gamesVersion once), PGN (headers,
 * not_finished), the legacy friend join race (one winner) and the cron's stale bot sweep.
 *
 * Skipped unless TEST_DATABASE_URL is set. Run it against a throwaway Docker Postgres ONLY (it creates users and
 * games): never Neon, never production.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { CompleteResponse, GameCreateResponse, GameDetailResponse } from "@repo/contracts/http/games";
import { ok } from "@repo/contracts/http/envelope";
import { PrismaClient } from "@repo/db";
import { createLiveGame, joinLiveGame } from "@repo/db/games";
import { staleBotSweepSql } from "@repo/db/live";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../../test/helpers/route-harness";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url; // lib/prisma (imported by the routes) reads it on first use

type Handlers = { POST?: RouteHandler; GET?: RouteHandler };
const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const OPERA_FEN = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
const OPERA_PGN = "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5";

describe("P2 game routes (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const run = Date.now().toString(36);
  const users: Record<"a" | "b" | "c", { id: bigint; ref: string; name: string }> = {} as never;
  let positionRef = "";
  let positionId = 0n;
  let create: Handlers, detail: Handlers, checkpoint: Handlers, complete: Handlers, pgn: Handlers;

  const viewerOf = (who: "a" | "b" | "c", member = true) =>
    viewerFixture({
      id: users[who].id,
      ref: users[who].ref,
      user: { name: users[who].name },
      ...(member ? {} : { entitlement: { member: false, entitled: false, state: "lapsed", trial: { used: true } } }),
    });

  async function call(h: Handlers, method: "GET" | "POST", path: string, who: "a" | "b" | "c", init: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string>; member?: boolean } = {}) {
    const t = installTestDeps({ userId: `user_${who}`, viewer: viewerOf(who, init.member ?? true), env: { ROUTE_VALIDATE_RESPONSES: "1" } });
    try {
      const handler = (method === "GET" ? h.GET : h.POST)!;
      const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
      return await handler(request(path, { method, headers: { "content-type": "application/json", ...init.headers }, body }), noParams(init.params ?? {}));
    } finally {
      t.restore();
    }
  }

  const createGame = (who: "a" | "b" | "c", body: unknown, key: string = randomUUID()) =>
    call(create, "POST", "/api/games", who, { body, headers: { "Idempotency-Key": key } });

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const who of ["a", "b", "c"] as const) {
      const u = await db.user.create({
        data: {
          googleId: `user_gint_${who}_${run}`,
          email: `gint-${who}-${run}@example.test`,
          name: `Games Int ${who.toUpperCase()}`,
          code: `${who}${run.slice(-5)}`.toUpperCase(),
          stats: { create: {} },
        },
        select: { id: true, referenceId: true, name: true },
      });
      users[who] = { id: u.id, ref: u.referenceId, name: u.name };
    }
    await db.user.upsert({
      where: { code: "CHESS_BOT_001" },
      create: { code: "CHESS_BOT_001", googleId: "bot_system_user", email: "bot@replaychess.local", name: "Chess Bot" },
      update: {},
    });
    const legend = await db.legend.create({
      data: { name: `Paul Morphy ${run}`, era: "Romantic Era", isVisible: true, shortDescription: "Int test legend" },
      select: { id: true },
    });
    const pos = await db.chessPosition.create({
      data: {
        fen: OPERA_FEN.replace(" 10", ` ${10 + (Date.now() % 50)}`),
        sideToMove: "white",
        pgn: OPERA_PGN,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl",
        whitePlayerId: legend.id,
        tournamentName: "Paris Opera",
        eventDate: new Date("1858-11-02T00:00:00Z"),
      },
      select: { id: true, referenceId: true },
    });
    positionRef = pos.referenceId;
    positionId = pos.id;
    create = (await import("@/app/api/games/route")) as Handlers;
    detail = (await import("@/app/api/games/[ref]/route")) as Handlers;
    checkpoint = (await import("@/app/api/games/[ref]/checkpoint/route")) as Handlers;
    complete = (await import("@/app/api/games/[ref]/complete/route")) as Handlers;
    pgn = (await import("@/app/api/games/[ref]/pgn/route")) as Handlers;
  });

  after(async () => {
    const ids = Object.values(users).map((u) => u.id);
    await db.$executeRawUnsafe(`DELETE FROM idempotency_keys WHERE "userId" = ANY($1::bigint[])`, ids);
    await db.game.deleteMany({ where: { creatorId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.chessPosition.deleteMany({ where: { id: positionId } });
    await db.$disconnect();
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  // ── POST /api/games ───────────────────────────────────────────────────────────────────────────────────────────
  it("creates a bot game from a position: 201, snapshot, game_players row, meta prefix, play counter", async () => {
    const before = await db.chessPosition.findUniqueOrThrow({ where: { id: positionId }, select: { timesPlayed: true } });
    const res = await createGame("a", { mode: "BOT", start: { kind: "position", positionRef }, tc: { initialSeconds: 300, incrementSeconds: 3 } });
    assert.equal(res.status, 201, await res.clone().text());
    const { data } = ok(GameCreateResponse).parse(await res.json());
    const snap = data.game;
    assert.equal(snap.mode, "BOT");
    assert.equal(snap.status, "IN_PROGRESS");
    assert.deepEqual(snap.you, { role: "player", color: "w" }); // auto: the position's side to move
    assert.equal(snap.bot?.elo, 1200); // no rating → the ladder default
    assert.equal(snap.timeClass, "blitz");
    assert.equal(snap.prefix.sans.split(" ").length, 18);
    assert.equal(snap.position?.legendSide, "w");
    assert.equal(snap.position?.afterLabel, "after 9…b5");
    assert.match(snap.header.left, /Paul Morphy vs Duke Karl 1858/);
    assert.equal(res.headers.get("location"), `/game/${snap.ref}`);
    const row = await db.game.findUniqueOrThrow({
      where: { referenceId: snap.ref },
      select: { mode: true, whitePlayerId: true, blackPlayerId: true, botElo: true, studySeconds: true, phase: true, gameData: true, players: true },
    });
    assert.equal(row.mode, "BOT");
    assert.equal(row.whitePlayerId, users.a.id);
    assert.equal(row.blackPlayerId, null);
    assert.equal(row.studySeconds, 0);
    assert.equal(row.phase, "PLAYING");
    assert.equal(row.gameData, null);
    assert.equal(row.players.length, 1);
    assert.equal(row.players[0]!.opponentName, "Engine 1200");
    const afterCount = await db.chessPosition.findUniqueOrThrow({ where: { id: positionId }, select: { timesPlayed: true } });
    assert.equal(afterCount.timesPlayed, before.timesPlayed + 1);
  });

  it("Idempotency-Key: the same body replays the same game; another body → 422; no key → 400", async () => {
    const key = randomUUID();
    const body = { mode: "BOT", start: { kind: "initial" }, color: "b", botElo: 800 };
    const first = await createGame("a", body, key);
    assert.equal(first.status, 201);
    const ref = ((await jsonOf(first)).data as { game: { ref: string } }).game.ref;
    const second = await createGame("a", body, key);
    assert.equal(second.status, 201);
    assert.equal(second.headers.get("idempotent-replayed"), "true");
    assert.equal(((await jsonOf(second)).data as { game: { ref: string } }).game.ref, ref);
    assert.equal(await db.game.count({ where: { creatorId: users.a.id, botElo: 800 } }), 1);
    const reused = await createGame("a", { ...body, botElo: 900 }, key);
    assert.equal(reused.status, 422);
    assert.equal(((await jsonOf(reused)).error as { code: string }).code, "idempotency_key_reused");
    const noKey = await call(create, "POST", "/api/games", "a", { body });
    assert.equal(noKey.status, 400);
  });

  it("LEGEND_BOT → 400 mode_not_available; an unknown position → 404 (stored and replayed)", async () => {
    const legendBot = await createGame("a", { mode: "LEGEND_BOT" });
    assert.equal(legendBot.status, 400);
    assert.equal(((await jsonOf(legendBot)).error as { details: { reason: string } }).details.reason, "mode_not_available");
    const key = randomUUID();
    const unknown = await createGame("a", { mode: "BOT", start: { kind: "position", positionRef: "cunknownunknownunknown00" } }, key);
    assert.equal(unknown.status, 404);
    const again = await createGame("a", { mode: "BOT", start: { kind: "position", positionRef: "cunknownunknownunknown00" } }, key);
    assert.equal(again.status, 404);
  });

  // ── GET /api/games/[ref] ──────────────────────────────────────────────────────────────────────────────────────
  it("snapshot: the player gets it (no-store while live); another member gets 404 for a bot game", async () => {
    const res = await createGame("a", { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 1400 });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    const mine = await call(detail, "GET", `/api/games/${ref}`, "a", { params: { ref } });
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get("cache-control"), "private, no-store");
    assert.equal(ok(GameDetailResponse).parse(await mine.json()).data.snapshot.ref, ref);
    const theirs = await call(detail, "GET", `/api/games/${ref}`, "c", { params: { ref } });
    assert.equal(theirs.status, 404);
  });

  it("snapshot of a live friend game: spectators get the projection one ply behind", async () => {
    const g = await createLiveGame(db, {
      mode: "FRIEND",
      creatorId: users.a.id,
      white: { userId: users.a.id, name: users.a.name },
      black: { userId: users.b.id, name: users.b.name },
      startingFen: INITIAL,
      initialTimeSeconds: 300,
      incrementSeconds: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await db.game.update({ where: { id: g.id }, data: { moves: "e2e4 e7e5", plyCount: 2, phase: "PLAYING" } });
    const spect = await call(detail, "GET", `/api/games/${g.ref}`, "c", { params: { ref: g.ref } });
    assert.equal(spect.status, 200);
    const snap = ok(GameDetailResponse).parse(await spect.json()).data.snapshot;
    assert.equal(snap.you.role, "spectator");
    assert.equal(snap.moves, "e2e4");
    assert.equal(snap.watchable, true);
    const player = ok(GameDetailResponse).parse(await (await call(detail, "GET", `/api/games/${g.ref}`, "b", { params: { ref: g.ref } })).json());
    assert.deepEqual(player.data.snapshot.you, { role: "player", color: "b" });
    assert.equal(player.data.snapshot.moves, "e2e4 e7e5");
  });

  // ── checkpoint ────────────────────────────────────────────────────────────────────────────────────────────────
  it("checkpoint: 204 and saved; an older rev is a 204 no-op; rev_gap 409; illegal 422; non-player 403", async () => {
    const res = await createGame("a", { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 1000, tc: { initialSeconds: 60, incrementSeconds: 0 } });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    const post = (who: "a" | "c", body: unknown, contentType = "application/json") =>
      call(checkpoint, "POST", `/api/games/${ref}/checkpoint`, who, { params: { ref }, body, headers: { "content-type": contentType } });
    const assists = { hints: 1, undos: 0 };
    assert.equal((await post("a", { rev: 2, moves: ["e2e4", "e7e5", "g1f3"], clocksMs: [59000, 58500, 57000], assists })).status, 204);
    let row = await db.game.findUniqueOrThrow({ where: { referenceId: ref }, select: { moves: true, plyCount: true, fen: true, whiteTimeMs: true, blackTimeMs: true, meta: true } });
    assert.equal(row.moves, "e2e4 e7e5 g1f3");
    assert.equal(row.plyCount, 3);
    assert.equal(row.whiteTimeMs, 57000);
    assert.equal(row.blackTimeMs, 58500);
    assert.equal((row.meta as { rev: number }).rev, 2);
    assert.match(row.fen!, /^rnbqkbnr\/pppp1ppp\/8\/4p3\/4P3\/5N2\/PPPP1PPP\/RNBQKB1R b/);
    // sendBeacon sends text/plain; an older rev (a late beacon) changes nothing.
    assert.equal((await post("a", JSON.stringify({ rev: 1, moves: ["e2e4"], clocksMs: [], assists }), "text/plain;charset=UTF-8")).status, 204);
    row = await db.game.findUniqueOrThrow({ where: { referenceId: ref }, select: { moves: true, plyCount: true, fen: true, whiteTimeMs: true, blackTimeMs: true, meta: true } });
    assert.equal(row.moves, "e2e4 e7e5 g1f3");
    // An undo (newer rev, shorter line) wins.
    assert.equal((await post("a", { rev: 3, moves: ["e2e4", "e7e5"], clocksMs: [59000, 58500], assists })).status, 204);
    row = await db.game.findUniqueOrThrow({ where: { referenceId: ref }, select: { moves: true, plyCount: true, fen: true, whiteTimeMs: true, blackTimeMs: true, meta: true } });
    assert.equal(row.moves, "e2e4 e7e5");
    const gap = await post("a", { rev: 100, moves: ["e2e4"], clocksMs: [], assists });
    assert.equal(gap.status, 409);
    assert.equal(((await jsonOf(gap)).error as { details: { reason: string } }).details.reason, "rev_gap");
    const illegal = await post("a", { rev: 4, moves: ["e2e4", "e7e5", "e1e3"], clocksMs: [], assists });
    assert.equal(illegal.status, 422);
    assert.equal(((await jsonOf(illegal)).error as { code: string }).code, "illegal_moves");
    assert.equal((await post("c", { rev: 5, moves: ["e2e4"], clocksMs: [], assists })).status, 403);
    const tooMany = await post("a", { rev: 5, moves: Array.from({ length: 401 }, () => "e2e4"), clocksMs: [], assists });
    assert.ok(tooMany.status === 400 || tooMany.status === 413, String(tooMany.status));
  });

  // ── complete + PGN ────────────────────────────────────────────────────────────────────────────────────────────
  it("complete: a genuine mate finishes once (stats and gamesVersion once), replays the stored result; PGN downloads", async () => {
    const res = await createGame("b", { mode: "BOT", start: { kind: "initial" }, color: "b", botElo: 400, tc: { initialSeconds: 600, incrementSeconds: 0 } });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    const live = await call(pgn, "GET", `/api/games/${ref}/pgn`, "b", { params: { ref } });
    assert.equal(live.status, 409);
    assert.equal(((await jsonOf(live)).error as { details: { reason: string } }).details.reason, "not_finished");

    const gv0 = (await db.user.findUniqueOrThrow({ where: { id: users.b.id }, select: { gamesVersion: true } })).gamesVersion;
    const body = {
      rev: 4,
      moves: ["f2f3", "e7e5", "g2g4", "d8h4"],
      clocksMs: [599000, 598000, 597000, 596000],
      result: "b",
      method: "checkmate",
      assists: { hints: 0, undos: 0 },
      endedAtClient: Date.now(),
    };
    const done = await call(complete, "POST", `/api/games/${ref}/complete`, "b", { params: { ref }, body });
    assert.equal(done.status, 200, await done.clone().text());
    assert.deepEqual(ok(CompleteResponse).parse(await done.json()).data, {
      status: "COMPLETED",
      outcome: "BLACK",
      method: "checkmate",
      analysis: { status: "none" },
    });
    const again = await call(complete, "POST", `/api/games/${ref}/complete`, "b", { params: { ref }, body });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("idempotent-replayed"), "true");

    const row = await db.game.findUniqueOrThrow({
      where: { referenceId: ref },
      select: { status: true, endMethod: true, outcome: true, plyCount: true, pgn: true, result: true, players: { select: { result: true, endedAt: true } } },
    });
    assert.equal(row.status, "COMPLETED");
    assert.equal(row.endMethod, "CHECKMATE");
    assert.equal(row.outcome, "BLACK");
    assert.equal(row.plyCount, 4);
    assert.equal(row.result, "CREATOR_WON");
    assert.equal(row.players[0]!.result, "WIN");
    assert.ok(row.players[0]!.endedAt);
    assert.match(row.pgn!, /0-1/);
    const stats = await db.userStats.findUniqueOrThrow({ where: { userId: users.b.id }, select: { gamesWon: true, totalGamesPlayed: true } });
    assert.equal(stats.gamesWon, 1);
    assert.equal(stats.totalGamesPlayed, 1);
    const gv1 = (await db.user.findUniqueOrThrow({ where: { id: users.b.id }, select: { gamesVersion: true } })).gamesVersion;
    assert.equal(gv1, gv0 + 1);

    const file = await call(pgn, "GET", `/api/games/${ref}/pgn`, "b", { params: { ref } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("cache-control"), "private, no-store");
    assert.equal(file.headers.get("content-type"), "text/x-chess-pgn; charset=utf-8");
    assert.equal(file.headers.get("content-disposition"), `attachment; filename="replaychess-${ref}.pgn"`);
    assert.match(await file.text(), /%clk/);
    assert.equal((await call(pgn, "GET", `/api/games/${ref}/pgn`, "c", { params: { ref } })).status, 404);

    const finished = await call(detail, "GET", `/api/games/${ref}`, "b", { params: { ref } });
    assert.equal(finished.status, 200);
    const etag = finished.headers.get("etag");
    assert.ok(etag);
    assert.match(finished.headers.get("cache-control") ?? "", /private/);
    const notModified = await call(detail, "GET", `/api/games/${ref}`, "b", { params: { ref }, headers: { "if-none-match": etag! } });
    assert.equal(notModified.status, 304);
  });

  it("complete: a forged mate → 422 illegal_moves {reason: claim_mismatch}; non-player → 403", async () => {
    const res = await createGame("a", { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 600 });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    const body = { rev: 1, moves: ["e2e4"], clocksMs: [], result: "w", method: "checkmate", assists: { hints: 0, undos: 0 }, endedAtClient: Date.now() };
    const forged = await call(complete, "POST", `/api/games/${ref}/complete`, "a", { params: { ref }, body });
    assert.equal(forged.status, 422);
    const error = (await jsonOf(forged)).error as { code: string; details: { reason: string } };
    assert.equal(error.code, "illegal_moves");
    assert.equal(error.details.reason, "claim_mismatch");
    assert.equal((await call(complete, "POST", `/api/games/${ref}/complete`, "c", { params: { ref }, body })).status, 403);
    const abort = await call(complete, "POST", `/api/games/${ref}/complete`, "a", {
      params: { ref },
      body: { ...body, result: "aborted", method: "aborted" },
    });
    assert.equal(abort.status, 200);
    assert.equal(ok(CompleteResponse).parse(await abort.json()).data.status, "ABORTED");
  });

  it("regression: FIX-A — a forged 'the bot lost on time' claim right after the start → 422 claim_mismatch (SEC-07)", async () => {
    const res = await createGame("a", {
      mode: "BOT",
      start: { kind: "initial" },
      color: "b",
      botElo: 600,
      tc: { initialSeconds: 600, incrementSeconds: 0 },
    });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    const body = {
      rev: 1,
      moves: ["e2e4", "e7e5"],
      clocksMs: [600_000, 600_000],
      result: "b",
      method: "timeout",
      assists: { hints: 0, undos: 0 },
      endedAtClient: Date.now(),
    };
    const forged = await call(complete, "POST", `/api/games/${ref}/complete`, "a", { params: { ref }, body });
    assert.equal(forged.status, 422);
    const error = (await jsonOf(forged)).error as { code: string; details: { reason: string; why: string } };
    assert.equal(error.details.reason, "claim_mismatch");
    assert.equal(error.details.why, "timeout_clock");
  });

  // ── legacy writers and the cron ───────────────────────────────────────────────────────────────────────────────
  it("legacy friend join: two concurrent joins → exactly one wins", async () => {
    const g = await createLiveGame(db, {
      mode: "FRIEND",
      creatorId: users.a.id,
      white: { userId: users.a.id, name: users.a.name },
      black: null,
      startingFen: INITIAL,
      initialTimeSeconds: 300,
      incrementSeconds: 0,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const [x, y] = await Promise.all([
      joinLiveGame(db, { ref: g.ref, me: { userId: users.b.id, name: users.b.name } }),
      joinLiveGame(db, { ref: g.ref, me: { userId: users.c.id, name: users.c.name } }),
    ]);
    assert.equal([x, y].filter(Boolean).length, 1);
    assert.equal(await db.gamePlayer.count({ where: { game: { referenceId: g.ref } } }), 2);
  });

  it("the cron's stale bot sweep aborts week-old bot games and bumps gamesVersion once per player", async () => {
    const res = await createGame("c", { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 2200 });
    const ref = ((await jsonOf(res)).data as { game: { ref: string } }).game.ref;
    await db.game.update({ where: { referenceId: ref }, data: { lastMoveAt: new Date(Date.now() - 8 * 86_400_000) } });
    const gv0 = (await db.user.findUniqueOrThrow({ where: { id: users.c.id }, select: { gamesVersion: true } })).gamesVersion;
    const rows = await db.$queryRaw<{ aborted: number }[]>(staleBotSweepSql());
    assert.ok(rows[0]!.aborted >= 1);
    const row = await db.game.findUniqueOrThrow({ where: { referenceId: ref }, select: { status: true, players: { select: { result: true } } } });
    assert.equal(row.status, "ABORTED");
    assert.equal(row.players[0]!.result, "ABORTED");
    const gv1 = (await db.user.findUniqueOrThrow({ where: { id: users.c.id }, select: { gamesVersion: true } })).gamesVersion;
    assert.equal(gv1, gv0 + 1);
  });
});
