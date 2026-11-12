/**
 * API contract of G1 `GET /api/me/games` and PR1 `GET /api/practice/context` (phase-03 plan §7.2, §9.3, §12.2; task D5)
 * against a real Postgres after `prisma migrate deploy`:
 *
 * - keyset pages over `game_players."endedAt"` (ties broken by gameId), newest first, finished games only, the viewer's
 *   rows only; page 1 carries `filteredTotal` + `counts`, page 2 only `nextCursor`; `limit=0` is counts only;
 * - the filters (result, time control, moments, search with `%`/`_` taken literally) and their totals;
 * - the ETag `g<gamesVersion>-<hash>`: a revalidation is a 304 with **0 statements** (the viewer is not a DB read here),
 *   a gamesVersion bump changes the tag; a tampered cursor is a 400 on `cursor`;
 * - the plan shape: with seq scans and sorts disabled the page statement still has an index path with no Sort node;
 * - PR1 for a game ply, a position and a FEN, with the player check, the ply range and the illegal-FEN 400.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { encodeCursor } from "@repo/contracts/http/cursor";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { GamesListResponse, GamesPageMeta, type GameRowDTO, type GamesFilter } from "@repo/contracts/http/games";
import { PracticeContextDTO } from "@repo/contracts/http/practice";
import { PrismaClient } from "@repo/db";
import type { RouteHandler } from "@/lib/api/route";
import type { Viewer } from "@/lib/auth/viewer";
import { archivePageSql } from "@/lib/services/analysis/archive-sql";
import { setLapsedReadFlag } from "@/lib/services/analysis/reader";
import { routeStatements } from "../helpers/query-counter";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";
import { createWithFreeFen } from "../helpers/unique-fen";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MOVES = "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

type Spec = {
  result: "WIN" | "LOSS" | "DRAW" | "ABORTED" | null;
  tc: "RAPID" | "BLITZ" | "BULLET";
  opponent: string;
  /** null = a bot game (no opponent member). */
  opponentMember: boolean;
  moments: number;
  endedAt: Date | null;
  openingName?: string;
  positionName?: string;
  legend?: boolean;
};

describe("P3 archive and practice routes: contract (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db!: PrismaClient;
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const users: Record<"e" | "f", { id: bigint; ref: string; name: string }> = {} as never;
  const gameIds: bigint[] = [];
  const refs: string[] = [];
  /** The finished games of E, newest first (the expected order). */
  let expected: { ref: string; endedAt: number; id: bigint; spec: Spec }[] = [];
  let G1!: RouteHandler;
  let PR1!: RouteHandler;
  let positionRef = "";
  let positionId: bigint | null = null;

  const viewerE = (overrides: Parameters<typeof viewerFixture>[0] = {}): Viewer =>
    viewerFixture({ id: users.e.id, ref: users.e.ref, user: { name: users.e.name }, gamesVersion: 7, ...overrides });

  async function get(handler: RouteHandler, path: string, viewer: Viewer | null, headers: Record<string, string> = {}) {
    const t = installTestDeps({ userId: viewer ? "user_e" : null, viewer, env: { ROUTE_VALIDATE_RESPONSES: "1" }, clock: Date.now() });
    try {
      const res = await handler(request(path, { headers }), noParams());
      return { res, recorded: t.recorded };
    } finally {
      t.restore();
    }
  }

  async function page(query: string, viewer: Viewer = viewerE()) {
    const { res, recorded } = await get(G1, `/api/me/games?${query}`, viewer);
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await jsonOf(res)) as { data: unknown; meta: unknown };
    return {
      res,
      recorded,
      rows: GamesListResponse.parse(body.data) as GameRowDTO[],
      meta: GamesPageMeta.strict().parse(body.meta),
    };
  }

  async function addGame(owner: "e" | "f", spec: Spec, i: number) {
    const finished = spec.result !== null;
    const g = await db.game.create({
      data: {
        creatorId: users[owner].id,
        opponentId: spec.opponentMember ? users[owner === "e" ? "f" : "e"].id : null,
        status: spec.result === null ? "IN_PROGRESS" : spec.result === "ABORTED" ? "ABORTED" : "COMPLETED",
        startingFen: INITIAL,
        startPly: 0,
        initialTimeSeconds: spec.tc === "BLITZ" ? 180 : spec.tc === "BULLET" ? 60 : 600,
        incrementSeconds: spec.tc === "BLITZ" ? 2 : 0,
        creatorTimeRemaining: 600,
        opponentTimeRemaining: 600,
        expiresAt: new Date(Date.now() + DAY),
        mode: spec.opponentMember ? "ONLINE" : "BOT",
        timeClass: spec.tc,
        whitePlayerId: users[owner].id,
        blackPlayerId: spec.opponentMember ? users[owner === "e" ? "f" : "e"].id : null,
        moves: MOVES,
        plyCount: 8,
        fen: "r1bqkb1r/pppp1ppp/2n2n2/3pp1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq d6 0 5",
        outcome: finished ? "WHITE" : null,
        endMethod: finished ? "RESIGNATION" : null,
        completedAt: spec.endedAt,
        analysisStatus: spec.moments > 0 ? "DONE" : i % 5 === 0 ? "QUEUED" : "NONE",
        ecoCode: spec.openingName ? "B20" : null,
        openingName: spec.openingName ?? null,
        meta: spec.positionName
          ? { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: { name: spec.positionName, event: null, year: 1858, afterLabel: null, legendSide: "w" } }
          : undefined,
        botElo: spec.opponentMember ? null : 1400,
      },
      select: { id: true, referenceId: true },
    });
    gameIds.push(g.id);
    refs.push(g.referenceId);
    await db.gamePlayer.create({
      data: {
        gameId: g.id,
        userId: users[owner].id,
        color: "w",
        mode: spec.opponentMember ? "ONLINE" : "BOT",
        timeClass: spec.tc,
        result: spec.result,
        endedAt: spec.endedAt,
        opponentUserId: spec.opponentMember ? users[owner === "e" ? "f" : "e"].id : null,
        opponentName: spec.opponent,
        opponentRating: 1200 + i,
        accuracy: spec.moments > 0 ? 80.4 : null,
        headline: spec.moments > 0 ? `Missed Rxf5 · move ${i}` : null,
        momentsCount: spec.moments,
      },
    });
    if (spec.legend) {
      await db.legendComparison.create({ data: { gameId: g.id, userId: users[owner].id, facts: { v: 1 } } });
    }
    return g;
  }

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const who of ["e", "f"] as const) {
      const u = await db.user.create({
        data: {
          googleId: `user_arch_${who}_${run}`,
          email: `arch-${who}-${run}@example.test`,
          name: `Archive ${who.toUpperCase()}`,
          code: `A${who}${run.slice(-4)}`.toUpperCase(),
        },
        select: { id: true, referenceId: true, name: true },
      });
      users[who] = { id: u.id, ref: u.referenceId, name: u.name };
    }
    const specs: Spec[] = [];
    for (let i = 0; i < 34; i++) {
      specs.push({
        result: (["WIN", "LOSS", "DRAW"] as const)[i % 3]!,
        tc: i % 4 === 0 ? "BLITZ" : "RAPID",
        opponent: i % 6 === 0 ? "tal_fan_77" : i % 2 === 0 ? "Engine 1400" : `rival_${i}`,
        opponentMember: i % 2 === 1,
        moments: i % 3 === 1 ? 2 : 0,
        endedAt: new Date(T0 + i * DAY),
        openingName: i === 7 ? "Sicilian Defense" : undefined,
        positionName: i === 9 ? "Opera Game" : undefined,
        legend: i === 9,
      });
    }
    // A tie on endedAt (the gameId breaks it), an opponent whose name has LIKE wildcards, and three rows that must
    // never appear: a live game, an aborted one and F's own game.
    specs.push({ result: "WIN", tc: "RAPID", opponent: "50%_off", opponentMember: true, moments: 0, endedAt: new Date(T0 + 20 * DAY) });
    const live: Spec = { result: null, tc: "RAPID", opponent: "live_one", opponentMember: true, moments: 0, endedAt: null };
    const aborted: Spec = { result: "ABORTED", tc: "RAPID", opponent: "aborted_one", opponentMember: true, moments: 0, endedAt: new Date(T0 + 40 * DAY) };
    const created: { ref: string; endedAt: number; id: bigint; spec: Spec }[] = [];
    for (const [i, spec] of specs.entries()) {
      const g = await addGame("e", spec, i);
      created.push({ ref: g.referenceId, id: g.id, endedAt: spec.endedAt!.getTime(), spec });
    }
    await addGame("e", live, 90);
    await addGame("e", aborted, 91);
    await addGame("f", { result: "WIN", tc: "RAPID", opponent: "someone", opponentMember: false, moments: 0, endedAt: new Date(T0 + 50 * DAY) }, 92);
    expected = created.sort((a, b) => b.endedAt - a.endedAt || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0));

    const pos = await createWithFreeFen("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", (fen) => db.chessPosition.create({
      data: {
        fen,
        sideToMove: "white",
        moveNumber: 4,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl",
        tournamentName: "Paris",
      },
      select: { id: true, referenceId: true },
    }));
    positionId = pos.id;
    positionRef = pos.referenceId;
    G1 = (await import("@/app/api/me/games/route")).GET as RouteHandler;
    PR1 = (await import("@/app/api/practice/context/route")).GET as RouteHandler;
  });

  after(async () => {
    if (!db) return;
    await db.game.deleteMany({ where: { id: { in: gameIds } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    if (positionId !== null) await db.chessPosition.deleteMany({ where: { id: positionId } });
    await db.$disconnect();
  });

  it("page 1: 30 rows newest first, the viewer's finished games only, totals in meta, a strong g<version> ETag", async () => {
    const { res, rows, meta, recorded } = await page("");
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    assert.match(res.headers.get("etag") ?? "", /^"g7-[0-9a-f]{16}"$/);
    assert.equal(rows.length, 30);
    assert.deepEqual(rows.map((r) => r.ref), expected.slice(0, 30).map((e) => e.ref));
    assert.equal(meta.filteredTotal, expected.length);
    assert.deepEqual(meta.counts, { all: expected.length });
    assert.ok(meta.nextCursor);
    assert.equal(routeStatements(recorded), 2, "the page and the counts");
    for (const r of rows) assert.ok(!["live_one", "aborted_one", "someone"].includes(r.opponent.name));
    const first = rows.find((r) => r.ref === expected.find((e) => e.spec.legend)!.ref)!;
    assert.equal(first.hasComparison, true);
    assert.equal(first.positionTitle, "Opera Game");
    const bot = rows.find((r) => r.opponent.name === "Engine 1400")!;
    assert.equal(bot.opponent.kind, "bot");
    const member = rows.find((r) => r.opponent.name.startsWith("rival_"))!;
    assert.equal(member.opponent.kind, "member");
    const reviewed = rows.find((r) => r.momentsCount > 0)!;
    assert.deepEqual({ s: reviewed.analysisStatus, a: reviewed.accuracy }, { s: "done", a: 80 });
    assert.equal(rows.find((r) => r.opening)?.opening?.name, "Sicilian Defense");
  });

  it("page 2 via the cursor: the rest, in order, no duplicates, only nextCursor in meta (AP-38); one statement", async () => {
    const one = await page("");
    const two = await page(`cursor=${one.meta.nextCursor}`);
    assert.deepEqual(two.meta, { nextCursor: null });
    assert.deepEqual([...one.rows, ...two.rows].map((r) => r.ref), expected.map((e) => e.ref));
    assert.equal(routeStatements(two.recorded), 1);
  });

  it("If-None-Match with the current tag → 304 with no statement; a gamesVersion bump changes the tag", async () => {
    const one = await page("result=loss");
    const etag = one.res.headers.get("etag")!;
    const again = await get(G1, "/api/me/games?result=loss", viewerE(), { "if-none-match": etag });
    assert.equal(again.res.status, 304);
    assert.equal(await again.res.text(), "");
    assert.equal(routeStatements(again.recorded), 0, "the G1 probe is the viewer only");
    const bumped = await get(G1, "/api/me/games?result=loss", viewerE({ gamesVersion: 8 }), { "if-none-match": etag });
    assert.equal(bumped.res.status, 200);
    assert.match(bumped.res.headers.get("etag") ?? "", /^"g8-/);
    const otherFilter = await page("result=win");
    assert.notEqual(otherFilter.res.headers.get("etag"), etag);
  });

  it("filters: result, time control, moments, search (wildcards literal); the totals follow, counts.all does not", async () => {
    const all = expected.length;
    const losses = await page("result=loss");
    assert.ok(losses.rows.every((r) => r.result === "loss"));
    assert.equal(losses.meta.filteredTotal, expected.filter((e) => e.spec.result === "LOSS").length);
    assert.deepEqual(losses.meta.counts, { all });
    const blitz = await page("tc=blitz&result=win,draw");
    assert.ok(blitz.rows.every((r) => r.tc.timeClass === "blitz" && r.result !== "loss"));
    assert.equal(blitz.rows.length, expected.filter((e) => e.spec.tc === "BLITZ" && e.spec.result !== "LOSS").length);
    const moments = await page("moments=1");
    assert.ok(moments.rows.length > 0 && moments.rows.every((r) => r.momentsCount > 0));
    const notMoments = await page("moments=0");
    assert.equal(notMoments.meta.filteredTotal, all, "moments=0 is no filter (never Boolean('0'))");
    const tal = await page("q=tal");
    assert.equal(tal.rows.length, expected.filter((e) => e.spec.opponent === "tal_fan_77").length);
    assert.equal((await page("q=sicil")).rows.length, 1, "the opening name");
    assert.equal((await page("q=opera")).rows.length, 1, "the position title");
    const wild = await page(`q=${encodeURIComponent("%_")}`);
    assert.deepEqual(wild.rows.map((r) => r.opponent.name), ["50%_off"]);
    const none = await page("q=pawnstorm");
    assert.deepEqual({ n: none.rows.length, f: none.meta.filteredTotal, a: none.meta.counts?.all }, { n: 0, f: 0, a: all });
    const one = await page("q=t");
    assert.equal(one.meta.filteredTotal, all, "a 1-character search is ignored");
  });

  it("limit=0: no rows, the totals only (one statement)", async () => {
    const { rows, meta, recorded } = await page("limit=0&result=draw");
    assert.deepEqual(rows, []);
    assert.deepEqual(meta, {
      nextCursor: null,
      filteredTotal: expected.filter((e) => e.spec.result === "DRAW").length,
      counts: { all: expected.length },
    });
    assert.equal(routeStatements(recorded), 1);
  });

  it("a tampered, foreign-version or malformed cursor → 400 on cursor; limit 31 → 400", async () => {
    for (const cursor of [encodeCursor(["not-a-date", "1"]), encodeCursor(["2026-10-01T12:00:00.000Z"]), "@@@", encodeCursor(["2026-10-01T12:00:00.000Z", "-1"])]) {
      const { res } = await get(G1, `/api/me/games?cursor=${encodeURIComponent(cursor)}`, viewerE());
      assert.equal(res.status, 400, cursor);
      const body = ErrorEnvelope.parse(await jsonOf(res));
      assert.equal(body.error.code, "validation_failed");
      assert.ok(body.error.fields?.cursor, cursor);
    }
    assert.equal((await get(G1, "/api/me/games?limit=31", viewerE())).res.status, 400);
  });

  it("membership: signed out 401, never a member 402; lapsed 402, or 200 with review-lapsed-read", async () => {
    assert.equal((await get(G1, "/api/me/games", null)).res.status, 401);
    const never = viewerE({ entitlement: { member: false, entitled: false, state: "none", trial: { used: false, eligible: true } } });
    assert.equal((await get(G1, "/api/me/games", never)).res.status, 402);
    const lapsed = viewerE({ entitlement: { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } });
    assert.equal((await get(G1, "/api/me/games", lapsed)).res.status, 402);
    const restore = setLapsedReadFlag(async () => true);
    try {
      assert.equal((await get(G1, "/api/me/games", lapsed)).res.status, 200);
      assert.equal((await get(G1, "/api/me/games", never)).res.status, 402);
    } finally {
      restore();
    }
  });

  it("the page statement has an index path with no Sort node (keyset and filters included)", async () => {
    const cursor = { endedAt: new Date(T0 + 20 * DAY).toISOString(), gameId: "999999999" };
    const cases: [GamesFilter, typeof cursor | null][] = [
      [{}, null],
      [{}, cursor],
      [{ result: ["loss"], tc: ["rapid"], moments: true, q: "tal" }, cursor],
    ];
    for (const [filter, c] of cases) {
      const sql = archivePageSql(users.e.id, filter, c, 30);
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql.text}`, ...sql.values);
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      });
      assert.match(plan, /game_players_userId_endedAt_gameId_idx/, plan);
      assert.doesNotMatch(plan, /\bSort\b/, plan);
      if (c) assert.match(plan, /Index Cond: .*endedAt/s, `the keyset is an index condition:\n${plan}`);
    }
  });

  describe("PR1 practice context", () => {
    const ctxOf = async (query: string, viewer: Viewer | null = viewerE()) => get(PR1, `/api/practice/context?${query}`, viewer);

    it("?game=&ply=: the position before ply n of the viewer's finished game, their colour; Back → the review", async () => {
      const ref = expected[0]!.ref;
      const { res } = await ctxOf(`game=${ref}&ply=4`);
      assert.equal(res.status, 200, await res.clone().text());
      assert.equal(res.headers.get("cache-control"), "private, no-cache");
      const dto = ok(PracticeContextDTO).parse(await jsonOf(res)).data;
      assert.equal(dto.source, "game");
      assert.equal(dto.fen, "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
      assert.deepEqual({ s: dto.sideToMove, h: dto.humanColor, f: dto.fromLabel }, { s: "w", h: "w", f: "Practice · from move 3" });
      assert.equal(dto.backHref, `/review/${ref}`);
      assert.equal(dto.compareHref, null);
      assert.equal(dto.botElo, 1400);
    });

    it("?game=: a non-player, a live game, a ply out of range", async () => {
      const ref = expected[0]!.ref;
      const viewerF = viewerFixture({ id: users.f.id, ref: users.f.ref });
      assert.equal((await ctxOf(`game=${ref}`, viewerF)).res.status, 404, "F is not a player of E's bot game");
      const liveRef = refs[expected.length]!;
      assert.equal((await ctxOf(`game=${liveRef}`)).res.status, 404, "a live game is never practice material");
      const far = await ctxOf(`game=${ref}&ply=8`);
      assert.equal(far.res.status, 400);
      assert.ok(ErrorEnvelope.parse(await jsonOf(far.res)).error.fields?.ply);
    });

    it("?position=: the side to move plays; Back → the position page; unknown → 404", async () => {
      const { res } = await ctxOf(`position=${positionRef}`);
      const dto = ok(PracticeContextDTO).parse(await jsonOf(res)).data;
      assert.deepEqual(
        { s: dto.source, t: dto.title, h: dto.humanColor, b: dto.backHref, f: dto.fromLabel },
        { s: "position", t: "Paul Morphy vs Duke Karl", h: "w", b: `/position/${positionRef}`, f: "Practice · from move 4" },
      );
      assert.equal((await ctxOf("position=cnosuchposition0000000000")).res.status, 404);
    });

    it("?fen=: a legal FEN plays; an illegal one is 400 illegal_position; two sources are 400", async () => {
      const good = await ctxOf(`fen=${encodeURIComponent("8/8/8/4k3/8/8/4P3/4K3 b - - 0 1")}`);
      const dto = ok(PracticeContextDTO).parse(await jsonOf(good.res)).data;
      assert.deepEqual({ s: dto.sideToMove, h: dto.humanColor, back: dto.backHref }, { s: "b", h: "b", back: "/play" });
      const bad = await ctxOf(`fen=${encodeURIComponent("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1")}`);
      assert.equal(bad.res.status, 400);
      assert.equal((ErrorEnvelope.parse(await jsonOf(bad.res)).error.details as { reason?: string }).reason, "illegal_position");
      assert.equal((await ctxOf(`fen=x&position=${positionRef}`)).res.status, 400);
    });

    it("membership: signed out 401, never a member 402", async () => {
      assert.equal((await ctxOf(`position=${positionRef}`, null)).res.status, 401);
      const never = viewerE({ entitlement: { member: false, entitled: false, state: "none", trial: { used: false, eligible: true } } });
      assert.equal((await ctxOf(`position=${positionRef}`, never)).res.status, 402);
    });
  });
});
