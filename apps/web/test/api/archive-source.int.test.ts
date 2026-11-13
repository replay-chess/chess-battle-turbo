// G1 with the P4 source tab (phase-04 plan §4.11; interface-check §0.9), against Postgres: `?source=` filters on the
// player row's source, the counts carry `replay`/`chesscom`/`lichess` once the member has imported games, a tab
// keeps the keyset paging and the other filters, and another member's imported games never count. Imported rows are
// written the way the batch writer writes them (`games.source` + `game_players.source`, mode IMPORTED, no opponent
// member). Runs with TEST_DATABASE_URL (a throwaway local Postgres with every migration), like the P3 archive test.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { GamesListResponse, GamesPageMeta, type GameRowDTO } from "@repo/contracts/http/games";
import { PrismaClient } from "@repo/db";
import type { RouteHandler } from "@/lib/api/route";
import type { Viewer } from "@/lib/auth/viewer";
import { archivePageSql } from "@/lib/services/analysis/archive-sql";
import { routeStatements } from "../helpers/query-counter";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MOVES = "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 f3g5 d7d5";
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);

type Source = "REPLAY" | "CHESSCOM" | "LICHESS";

describe("P4 archive source tabs: G1 contract (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db!: PrismaClient;
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const users: Record<"m" | "o", { id: bigint; ref: string }> = {} as never;
  const gameIds: bigint[] = [];
  /** Member M's finished games per source, newest first. */
  const mine: Record<Source, string[]> = { REPLAY: [], CHESSCOM: [], LICHESS: [] };
  let G1!: RouteHandler;

  const viewerM = (): Viewer => viewerFixture({ id: users.m.id, ref: users.m.ref, gamesVersion: 3 });

  async function page(query: string) {
    const t = installTestDeps({ userId: "user_m", viewer: viewerM(), env: { ROUTE_VALIDATE_RESPONSES: "1" }, clock: Date.now() });
    try {
      const res = await G1(request(`/api/me/games?${query}`), noParams());
      assert.equal(res.status, 200, await res.clone().text());
      const body = (await jsonOf(res)) as { data: unknown; meta: unknown };
      return { res, recorded: t.recorded, rows: GamesListResponse.parse(body.data) as GameRowDTO[], meta: GamesPageMeta.strict().parse(body.meta) };
    } finally {
      t.restore();
    }
  }

  async function addGame(owner: "m" | "o", source: Source, i: number, result: "WIN" | "LOSS" | "DRAW") {
    const imported = source !== "REPLAY";
    const endedAt = new Date(T0 + i * DAY);
    const g = await db.game.create({
      data: {
        creatorId: users[owner].id,
        opponentId: null,
        status: "COMPLETED",
        startingFen: INITIAL,
        startPly: 0,
        initialTimeSeconds: 300,
        incrementSeconds: 0,
        creatorTimeRemaining: 0,
        opponentTimeRemaining: 0,
        expiresAt: endedAt,
        mode: imported ? "IMPORTED" : "BOT",
        timeClass: "BLITZ",
        whitePlayerId: users[owner].id,
        blackPlayerId: null,
        moves: MOVES,
        plyCount: 8,
        fen: "r1bqkb1r/pppp1ppp/2n2n2/3pp1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq d6 0 5",
        outcome: result === "DRAW" ? "DRAW" : result === "WIN" ? "WHITE" : "BLACK",
        endMethod: imported ? "OTHER" : "RESIGNATION",
        completedAt: endedAt,
        analysisStatus: "NONE",
        source,
        externalId: imported ? `${source.toLowerCase()}-${run}-${owner}-${i}` : null,
        whiteName: imported ? "me" : null,
        blackName: imported ? `opp_${i}` : null,
        botElo: imported ? null : 1400,
      },
      select: { id: true, referenceId: true },
    });
    gameIds.push(g.id);
    await db.gamePlayer.create({
      data: {
        gameId: g.id,
        userId: users[owner].id,
        color: "w",
        mode: imported ? "IMPORTED" : "BOT",
        timeClass: "BLITZ",
        result,
        endedAt,
        source,
        opponentUserId: null,
        opponentName: imported ? `opp_${i}` : "Engine 1400",
        opponentRating: imported ? 1300 + i : null,
        momentsCount: 0,
      },
    });
    return { ref: g.referenceId, endedAt };
  }

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    for (const who of ["m", "o"] as const) {
      const u = await db.user.create({
        data: {
          googleId: `user_src_${who}_${run}`,
          email: `src-${who}-${run}@example.test`,
          name: `Source ${who.toUpperCase()}`,
          code: `S${who}${run.slice(-4)}`.toUpperCase(),
        },
        select: { id: true, referenceId: true },
      });
      users[who] = { id: u.id, ref: u.referenceId };
    }
    // M: 3 Replay, 33 Chess.com (two pages), 2 Lichess, interleaved in time. O: 2 Chess.com games of its own.
    const plan: Source[] = [];
    for (let i = 0; i < 38; i++) plan.push(i % 13 === 4 ? "LICHESS" : i % 12 === 0 ? "REPLAY" : "CHESSCOM");
    const made: { ref: string; endedAt: Date; source: Source }[] = [];
    for (const [i, source] of plan.entries()) {
      made.push({ ...(await addGame("m", source, i, (["WIN", "LOSS", "DRAW"] as const)[i % 3]!)), source });
    }
    for (let i = 0; i < 2; i++) await addGame("o", "CHESSCOM", 100 + i, "WIN");
    made.sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime());
    for (const g of made) mine[g.source].push(g.ref);
    G1 = (await import("@/app/api/me/games/route")).GET as RouteHandler;
  });

  after(async () => {
    if (!db) return;
    await db.game.deleteMany({ where: { id: { in: gameIds } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await db.$disconnect();
  });

  it("All: every finished game, with the per-source counts (the member has imported games)", async () => {
    const { meta, recorded } = await page("");
    const counts = { replay: mine.REPLAY.length, chesscom: mine.CHESSCOM.length, lichess: mine.LICHESS.length };
    assert.deepEqual(counts, { replay: 4, chesscom: 31, lichess: 3 }, "the seeded mix");
    assert.deepEqual(meta.counts, { all: 38, ...counts });
    assert.equal(meta.filteredTotal, 38);
    assert.equal(routeStatements(recorded), 2, "still the page and one counts statement");
  });

  it("?source=chesscom: only Chess.com rows, keyset paging across pages, filteredTotal follows the tab", async () => {
    const p1 = await page("source=chesscom");
    assert.equal(p1.rows.length, 30);
    assert.ok(p1.rows.every((r) => r.source === "chesscom"));
    assert.deepEqual(p1.rows.map((r) => r.ref), mine.CHESSCOM.slice(0, 30));
    assert.equal(p1.meta.filteredTotal, 31);
    assert.equal(p1.meta.counts?.all, 38, "the tab counts stay unfiltered");
    const p2 = await page(`source=chesscom&cursor=${encodeURIComponent(p1.meta.nextCursor!)}`);
    assert.deepEqual(p2.rows.map((r) => r.ref), mine.CHESSCOM.slice(30));
    assert.equal(p2.meta.nextCursor, null);
    const etag = (await page("source=lichess")).res.headers.get("etag");
    assert.notEqual(p1.res.headers.get("etag"), etag, "each tab has its own ETag");
  });

  it("?source=replay and ?source=lichess; a tab with the result filter; limit=0 counts a tab", async () => {
    assert.deepEqual((await page("source=replay")).rows.map((r) => r.ref), mine.REPLAY);
    assert.deepEqual((await page("source=lichess")).rows.map((r) => r.ref), mine.LICHESS);
    const wins = await page("source=chesscom&result=win");
    assert.ok(wins.rows.length > 0 && wins.rows.every((r) => r.source === "chesscom" && r.result === "win"));
    const count = await page("source=lichess&limit=0");
    assert.deepEqual({ n: count.rows.length, f: count.meta.filteredTotal }, { n: 0, f: mine.LICHESS.length });
  });

  it("an unknown source is a 400, never an unfiltered list", async () => {
    const t = installTestDeps({ userId: "user_m", viewer: viewerM(), env: {}, clock: Date.now() });
    try {
      const res = await G1(request("/api/me/games?source=fide"), noParams());
      assert.equal(res.status, 400);
    } finally {
      t.restore();
    }
  });

  it("a tab keeps the page statement on the archive index, with no Sort node (keyset included)", async () => {
    const cursor = { endedAt: new Date(T0 + 20 * DAY).toISOString(), gameId: "999999999" };
    for (const c of [null, cursor]) {
      const sql = archivePageSql(users.m.id, { source: "chesscom", result: ["win"] }, c, 30);
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql.text}`, ...sql.values);
        return rows.map((r) => r["QUERY PLAN"]).join("\n");
      });
      assert.match(plan, /game_players_userId_endedAt_gameId_idx/, plan);
      assert.doesNotMatch(plan, /\bSort\b/, plan);
      assert.match(plan, /Filter: .*source = \(?'CHESSCOM'/, `the tab is a filter on the player row:\n${plan}`);
    }
  });
});
