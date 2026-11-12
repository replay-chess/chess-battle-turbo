/**
 * Bot `complete` → analysis against a real Postgres (phase-03 plan §5.8, §7.4, §7.6; task E1 "bot complete → job +
 * facts"): a legend-position bot game finished with ≥ 6 plies gets ONE ANALYZE_GAME job (reason bot_end, GAME_ENDED)
 * in the finish statement, its legend facts row (FACTS_READY) for the member, a response with the queued seed and the
 * legend block, gamesVersion + 1, and after(): one signed kick (bot_end, watching the game), `analysis:queued` and
 * `games:changed` to the member. A replay answers the current state with no second job and no follow-ups. A short
 * game is skipped (no job, no kick) and a plain bot game has no legend block.
 *
 * Skipped unless TEST_DATABASE_URL is set. Run it against a throwaway Docker Postgres ONLY (it creates users, games,
 * positions and jobs): never Neon.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { parseKeyRing, verifyInternal } from "@repo/contracts/internal/auth";
import { JOB_PRIORITY, analyzeDedupeKey } from "@repo/contracts/internal/jobs";
import { KICK_PATH, KickBodyV1 } from "@repo/contracts/internal/kick";
import { CompleteResponse, GameCreateResponse } from "@repo/contracts/http/games";
import { ok } from "@repo/contracts/http/envelope";
import { EmitBody } from "@repo/contracts/socket/internal";
import { Prisma, PrismaClient } from "@repo/db";
import type { RouteHandler } from "@/lib/api/route";
import { setEmitTransport } from "@/lib/services/analysis/emit";
import { setKickTransport } from "@/lib/services/analysis/kick";
import { setReviewEventSink } from "@/lib/services/analysis/telemetry";
import { installTestDeps, noParams, request, viewerFixture } from "../../test/helpers/route-harness";
import { createWithFreeFen } from "../../test/helpers/unique-fen";
import { setGamesChangedTransport } from "./complete-analysis.server";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url; // lib/prisma (imported by the routes) reads it on first use

type Handlers = { POST?: RouteHandler };
const OPERA_FULL_PGN =
  "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 " +
  "11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0";
/**
 * After 9…b5, White to move; the halfmove clock is made unique per run (chess_positions.fen is unique). The position
 * links no `legends` row (legends.name is unique and the seed may hold Morphy), so the historical name comes from the
 * position's player name: "Paul Morphy" → "Morphy".
 */
const operaFen = (halfmove: number) => `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - ${halfmove} 10`;
/** 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.Ba4 (Morphy: 12.O-O-O) a5: 6 plies, the member leaves the path on ply 4. */
const DIVERGING = ["c3b5", "c6b5", "c4b5", "b8d7", "b5a4", "a7a5"];

const k = () => randomBytes(32).toString("base64");
const WEB_KEY = k();
/** The web's worker-only key (kicks are signed `webwk`, never with the socket key `web`; FIX-1). */
const WEBWK_KEY = k();

describe("bot complete → analysis job, legend facts and follow-ups (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const run = Date.now().toString(36);
  let member: { id: bigint; ref: string; name: string };
  let positionRef = "";
  let positionId = 0n;
  let create: Handlers, complete: Handlers;
  const kicks: { url: string; body: string; headers: Record<string, string> }[] = [];
  const emits: { body: string; headers: Record<string, string> }[] = [];
  const events: { event: string; props: Record<string, unknown>; distinctId: string }[] = [];
  const restores: (() => void)[] = [];
  const savedEnv = { ...process.env };

  const viewer = () => viewerFixture({ id: member.id, ref: member.ref, user: { name: member.name } });

  /** Runs a route with the test deps installed, then its after() tasks (the follow-ups use the deps too). */
  async function call(h: Handlers, path: string, body: unknown, params: Record<string, string>, headers: Record<string, string> = {}) {
    const t = installTestDeps({ userId: "user_wpe", viewer: viewer(), env: { ROUTE_VALIDATE_RESPONSES: "1" } });
    try {
      const res = await h.POST!(
        request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }),
        noParams(params),
      );
      for (const task of t.recorded.afterTasks.splice(0)) await task();
      return { res, recorded: t.recorded };
    } finally {
      t.restore();
    }
  }

  /** The member plays White (a position game: its side to move, White here). */
  async function newBotGame(start: { kind: "initial" } | { kind: "position"; positionRef: string }): Promise<string> {
    const body = { mode: "BOT", start, ...(start.kind === "initial" ? { color: "w" } : {}), tc: { initialSeconds: 300, incrementSeconds: 3 } };
    const { res } = await call(create, "/api/games", body, {}, { "Idempotency-Key": randomUUID() });
    assert.equal(res.status, 201, await res.clone().text());
    return ok(GameCreateResponse).parse(await res.json()).data.game.ref;
  }

  const completeBody = (moves: string[], result: "w" | "b") => ({
    rev: moves.length,
    moves,
    clocksMs: moves.map((_, i) => 300_000 - i * 1_000),
    result,
    method: "resignation",
    assists: { hints: 0, undos: 0 },
    endedAtClient: Date.now(),
  });

  async function gameIdOf(ref: string): Promise<bigint> {
    return (await db.game.findUniqueOrThrow({ where: { referenceId: ref }, select: { id: true } })).id;
  }
  async function jobsOf(gameId: bigint) {
    return db.$queryRaw<{ status: string; priority: number; payload: Record<string, unknown> }[]>(Prisma.sql`
      SELECT status::text AS status, priority, payload FROM jobs WHERE "dedupeKey" = ${analyzeDedupeKey(gameId)}`);
  }
  async function factsOf(gameId: bigint) {
    return db.$queryRaw<{ status: string; userId: bigint; facts: { historicalName: string; divergencePly: number | null } }[]>(Prisma.sql`
      SELECT status::text AS status, "userId", facts FROM legend_comparisons WHERE "gameId" = ${gameId}`);
  }
  const gamesVersion = async () =>
    (await db.user.findUniqueOrThrow({ where: { id: member.id }, select: { gamesVersion: true } })).gamesVersion;

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    process.env.ANALYSIS_WORKER_URL = "http://analysis-worker.test:3003";
    process.env.INTERNAL_API_SECRET = `web:${WEB_KEY},webwk:${WEBWK_KEY}`;
    process.env.NEXT_PUBLIC_WEBSOCKET_URL = "http://socket.test:3002";
    restores.push(
      setKickTransport(async (target, init) => {
        kicks.push({ url: String(target), body: String(init.body), headers: init.headers as Record<string, string> });
        return new Response(JSON.stringify({ draining: false, nextRunAt: null }), { status: 202 });
      }),
      setEmitTransport((async (_target: string | URL, init?: RequestInit) => {
        emits.push({ body: String(init?.body), headers: init?.headers as Record<string, string> });
        return new Response(JSON.stringify({ delivered: 1 }), { status: 202 });
      }) as typeof fetch),
      setReviewEventSink((event, props, distinctId) => events.push({ event, props, distinctId })),
      setGamesChangedTransport((async (_target: string | URL, init?: RequestInit) => {
        emits.push({ body: String(init?.body), headers: init?.headers as Record<string, string> });
        return new Response(JSON.stringify({ delivered: 1 }), { status: 202 });
      }) as typeof fetch),
    );
    const u = await db.user.create({
      data: {
        googleId: `user_wpe_${run}`,
        email: `wpe-${run}@example.test`,
        name: "WPE Member",
        code: `E${run.slice(-6)}`.toUpperCase(),
        stats: { create: {} },
      },
      select: { id: true, referenceId: true, name: true },
    });
    member = { id: u.id, ref: u.referenceId, name: u.name };
    await db.user.upsert({
      where: { code: "CHESS_BOT_001" },
      create: { code: "CHESS_BOT_001", googleId: "bot_system_user", email: "bot@replaychess.local", name: "Chess Bot" },
      update: {},
    });
    const pos = await createWithFreeFen(operaFen(0), (fen) => db.chessPosition.create({
      data: {
        fen,
        sideToMove: "white",
        pgn: OPERA_FULL_PGN,
        moveNumber: 10,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl / Count Isouard",
        tournamentName: "Paris Opera",
        eventDate: new Date("1858-11-02T00:00:00Z"),
      },
      select: { id: true, referenceId: true },
    }));
    positionRef = pos.referenceId;
    positionId = pos.id;
    create = (await import("@/app/api/games/route")) as Handlers;
    complete = (await import("@/app/api/games/[ref]/complete/route")) as Handlers;
  });

  after(async () => {
    for (const r of restores) r();
    process.env = savedEnv;
    const games = await db.game.findMany({ where: { creatorId: member.id }, select: { id: true } });
    const ids = games.map((g) => g.id);
    await db.$executeRaw(Prisma.sql`DELETE FROM jobs WHERE "gameId" = ANY(${ids}::bigint[])`);
    await db.$executeRaw(Prisma.sql`DELETE FROM legend_comparisons WHERE "gameId" = ANY(${ids}::bigint[])`);
    await db.$executeRaw(Prisma.sql`DELETE FROM idempotency_keys WHERE "userId" = ${member.id}`);
    await db.game.deleteMany({ where: { creatorId: member.id } });
    await db.user.deleteMany({ where: { id: member.id } });
    await db.chessPosition.deleteMany({ where: { id: positionId } });
    await db.$disconnect();
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });

  it("a legend-position bot game: one job, the member's facts, the queued seed + legend block, and the follow-ups", async () => {
    const ref = await newBotGame({ kind: "position", positionRef });
    const gameId = await gameIdOf(ref);
    const gv0 = await gamesVersion();
    kicks.length = 0;
    emits.length = 0;
    events.length = 0;

    const { res } = await call(complete, `/api/games/${ref}/complete`, completeBody(DIVERGING, "b"), { ref });
    assert.equal(res.status, 200, await res.clone().text());
    const out = ok(CompleteResponse).parse(await res.json()).data;
    assert.equal(out.status, "COMPLETED");
    assert.equal(out.analysis.status, "queued");
    assert.ok(typeof out.analysis.etaSec === "number" && out.analysis.etaSec > 0);

    // The legend block (§4.7): Morphy, matched 2 of 3 member moves, split on 12. (Ba4 vs O-O-O), replay from there.
    const cmp = out.comparison;
    assert.ok(cmp, "a legend block");
    assert.equal(cmp.legendName, "Morphy");
    assert.equal(cmp.legendResult, "white_won");
    assert.equal(cmp.status, "facts_ready");
    assert.deepEqual(cmp.divergence, { ply: 4, moveLabel: "12.", userSan: "Ba4", legendSan: "O-O-O", by: "user" });
    assert.equal(cmp.matched, 2);
    assert.equal(cmp.compareHref, `/review/${ref}/legend`);
    assert.equal(cmp.replayHref, `/practice?game=${encodeURIComponent(ref)}&ply=4`);
    assert.ok(cmp.rows.some((r) => r.n === "12." && r.yours === "Ba4" && r.legend === "O-O-O" && r.mark === "split"));

    const jobs = await jobsOf(gameId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.priority, JOB_PRIORITY.GAME_ENDED);
    assert.deepEqual(jobs[0]!.payload, { v: 1, gameId: gameId.toString(), gameRef: ref, reason: "bot_end" });
    const facts = await factsOf(gameId);
    assert.equal(facts.length, 1);
    assert.equal(facts[0]!.status, "FACTS_READY");
    assert.equal(facts[0]!.userId, member.id);
    assert.equal(facts[0]!.facts.historicalName, "Morphy");
    assert.equal(await gamesVersion(), gv0 + 1, "gamesVersion once (the finish's uv CTE)");

    // after(): one signed kick, analysis:queued and games:changed to the member.
    assert.equal(kicks.length, 1);
    assert.equal(kicks[0]!.url, `http://analysis-worker.test:3003${KICK_PATH}`);
    assert.deepEqual(KickBodyV1.parse(JSON.parse(kicks[0]!.body)), { v: 1, reason: "bot_end", watch: ref });
    assert.deepEqual(
      // Signed at the route deps' clock (the harness pins it), so verify at that instant.
      verifyInternal({
        headers: kicks[0]!.headers,
        method: "POST",
        path: KICK_PATH,
        body: kicks[0]!.body,
        keys: parseKeyRing(`webwk:${WEBWK_KEY}`),
        nowMs: Number(kicks[0]!.headers["x-rc-ts"]) * 1000,
      }),
      { ok: true, kid: "webwk" },
    );
    const bodies = emits.map((e) => EmitBody.parse(JSON.parse(e.body)));
    assert.deepEqual(bodies.map((b) => b.event).sort(), ["analysis:queued", "games:changed"]);
    for (const b of bodies) assert.deepEqual(b.targets, [{ userRef: member.ref }]);
    const queued = bodies.find((b) => b.event === "analysis:queued")!.data as { gameRef: string; etaSec: number };
    assert.equal(queued.gameRef, ref);
    assert.equal(queued.etaSec, out.analysis.etaSec);
    // regression: analysis-queued-once — a finished bot game never sent analysis_queued (plan §10.1, §12.2).
    const queuedEvents = events.filter((e) => e.event === "analysis_queued");
    assert.equal(queuedEvents.length, 1);
    const { queue_position, app_env, ...props } = queuedEvents[0]!.props;
    assert.equal(queuedEvents[0]!.distinctId, member.ref);
    assert.deepEqual(props, { game_mode: "legend_bot", source: "replay", reason: "bot_end", priority: JOB_PRIORITY.GAME_ENDED });
    assert.ok(typeof queue_position === "number" && queue_position >= 0);
    assert.equal(typeof app_env, "string");

    // A replay: the current state and the same block; no second job, no follow-ups, no second analysis_queued.
    kicks.length = 0;
    emits.length = 0;
    events.length = 0;
    const { res: again } = await call(complete, `/api/games/${ref}/complete`, completeBody(DIVERGING, "b"), { ref });
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    const replay = ok(CompleteResponse).parse(await again.json()).data;
    assert.equal(replay.analysis.status, "queued");
    assert.deepEqual(replay.comparison, cmp);
    assert.equal((await jobsOf(gameId)).length, 1);
    assert.equal((await factsOf(gameId)).length, 1);
    assert.equal(kicks.length + emits.length + events.length, 0);
  });

  it("a short game is skipped (no job, no kick, no legend block for a plain bot game); games:changed still goes out", async () => {
    const ref = await newBotGame({ kind: "initial" });
    const gameId = await gameIdOf(ref);
    kicks.length = 0;
    emits.length = 0;
    events.length = 0;
    const { res } = await call(complete, `/api/games/${ref}/complete`, completeBody(["e2e4", "e7e5", "g1f3", "b8c6"], "b"), { ref });
    assert.equal(res.status, 200, await res.clone().text());
    const out = ok(CompleteResponse).parse(await res.json()).data;
    assert.deepEqual(out.analysis, { status: "skipped", etaSec: null });
    assert.equal(out.comparison, null);
    assert.equal((await jobsOf(gameId)).length, 0);
    const status = await db.game.findUniqueOrThrow({ where: { id: gameId }, select: { analysisStatus: true } });
    assert.equal(status.analysisStatus, "SKIPPED");
    assert.equal(kicks.length, 0);
    assert.equal(events.length, 0, "no job, no analysis_queued");
    assert.deepEqual(emits.map((e) => EmitBody.parse(JSON.parse(e.body)).event), ["games:changed"]);
  });

  it("a plain bot game with ≥ 6 plies: queued, no legend block, no facts row", async () => {
    const ref = await newBotGame({ kind: "initial" });
    const gameId = await gameIdOf(ref);
    events.length = 0;
    const { res } = await call(complete, `/api/games/${ref}/complete`, completeBody(["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"], "b"), { ref });
    const out = ok(CompleteResponse).parse(await res.json()).data;
    assert.equal(out.analysis.status, "queued");
    assert.deepEqual(
      events.map((e) => [e.event, e.props.game_mode, e.props.reason]),
      [["analysis_queued", "bot", "bot_end"]],
    );
    assert.equal(out.comparison, null);
    assert.equal((await jobsOf(gameId)).length, 1);
    assert.equal((await factsOf(gameId)).length, 0);
  });
});
