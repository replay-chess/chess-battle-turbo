// P3 at the socket finish against Postgres (phase-03 plan §7.4, §5.8, §5.11; task E1/E3 "socket integration"):
//   - a live finish with ≥ 6 plies writes exactly ONE ANALYZE_GAME job in the finish statement, `game:result.review`
//     says queued with an ETA, the worker gets ONE signed kick (kid ws, reason live_end, watching the game), and both
//     members get `analysis:queued` and `games:changed` in their user rooms (with useq);
//   - a replayed finish (the outbox's retry after a lost response) adds no job and no gamesVersion bump, and kicks the
//     still-QUEUED job again;
//   - a short game is SKIPPED (no job, no kick, `review.status` skipped), an abort too; both still say games:changed.
// The socket's client is the replay_realtime role when TEST_REALTIME_DATABASE_URL is set (proves socket.p3.sql).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Prisma } from "@repo/db";
import { analyzeDedupeKey, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { parseKeyRing, verifyInternal } from "@repo/contracts/internal/auth";
import { KICK_PATH, KickBodyV1 } from "@repo/contracts/internal/kick";
import { AnalysisQueuedEvent, GameResultReview, GamesChangedEvent } from "@repo/contracts/socket/analysis";
import { closeAllClients, cmd, move, waitFor } from "./helpers";
import { DB_SKIP, adminDb, disconnectAdmin, playLine, startDbGame, startDbServer, userStats, type DbServer } from "./db";

const k = () => randomBytes(32).toString("base64");
const WS_KEY = k();
const SOCKET_RING = `web:${k()},ws:${WS_KEY}`;
const WORKER_RING = parseKeyRing(`wk:${k()},ws:${WS_KEY}`);
const WORKER_URL = "http://analysis-worker.test:3003";
const SIX = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"];

type Kick = { url: string; body: string; headers: Record<string, string> };

async function jobsOf(gameId: bigint) {
  return adminDb().$queryRaw<{ status: string; priority: number; payload: Record<string, unknown> }[]>(Prisma.sql`
    SELECT status::text AS status, priority, payload FROM jobs WHERE "dedupeKey" = ${analyzeDedupeKey(gameId)}`);
}

async function analysisStatus(gameId: bigint): Promise<string> {
  const rows = await adminDb().$queryRaw<{ s: string }[]>(Prisma.sql`SELECT "analysisStatus"::text AS s FROM games WHERE id = ${gameId}`);
  return rows[0]!.s;
}

describe("socket finish → analysis job, kick and events (Postgres)", { skip: DB_SKIP }, () => {
  let server: DbServer;
  const kicks: Kick[] = [];
  const kickFetch = (async (url: string | URL, init?: RequestInit) => {
    kicks.push({ url: String(url), body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({ draining: false, nextRunAt: null }), { status: 202 });
  }) as typeof fetch;

  before(async () => {
    server = await startDbServer({
      env: { INTERNAL_API_SECRET: SOCKET_RING, ANALYSIS_WORKER_URL: WORKER_URL },
      kickFetch,
    });
  });
  afterEach(() => closeAllClients());
  after(async () => {
    await server.close();
    await disconnectAdmin();
  });

  const kicksFor = (ref: string) => kicks.filter((x) => (JSON.parse(x.body) as { watch?: string }).watch === ref);
  const until = async (pred: () => boolean, ms = 5_000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  test("one job per finish; game:result review queued; one signed kick; analysis:queued + games:changed to both", async () => {
    const { w, b, game, W, B, session } = await startDbGame(server);
    const versions = [(await userStats(w.id)).version, (await userStats(b.id)).version];
    const queuedW = waitFor(W, "analysis:queued", 5_000);
    const queuedB = waitFor(B, "analysis:queued", 5_000);
    const changedW = waitFor(W, "games:changed", 5_000);
    const changedB = waitFor(B, "games:changed", 5_000);
    const result = waitFor(W, "game:result", 5_000);
    await playLine(W, B, game.ref, SIX);
    assert.deepEqual(await cmd(B, "game:resign", { ref: game.ref }), { ok: true });

    const res = await result;
    const review = GameResultReview.parse(res.review);
    assert.equal(review.status, "queued");
    assert.ok(typeof review.etaSec === "number" && review.etaSec > 0, "an ETA");

    const jobs = await jobsOf(game.id);
    assert.equal(jobs.length, 1, "exactly one job");
    assert.equal(jobs[0]!.status, "QUEUED");
    assert.equal(jobs[0]!.priority, JOB_PRIORITY.GAME_ENDED);
    assert.deepEqual(jobs[0]!.payload, { v: 1, gameId: game.id.toString(), gameRef: game.ref, reason: "live_end" });
    assert.equal(await analysisStatus(game.id), "QUEUED");

    const qw = AnalysisQueuedEvent.parse(await queuedW);
    assert.equal(qw.gameRef, game.ref);
    assert.equal(qw.etaSec, review.etaSec, "the same ETA as the game-over seed");
    AnalysisQueuedEvent.parse(await queuedB);
    assert.equal(GamesChangedEvent.parse(await changedW).gameRef, game.ref);
    assert.equal(GamesChangedEvent.parse(await changedB).gameRef, game.ref);
    assert.equal(typeof ((await queuedW) as { useq?: unknown }).useq, "number", "user-room events carry useq");

    await until(() => kicksFor(game.ref).length === 1);
    const kick = kicksFor(game.ref)[0]!;
    assert.equal(kick.url, `${WORKER_URL}${KICK_PATH}`);
    assert.deepEqual(KickBodyV1.parse(JSON.parse(kick.body)), { v: 1, reason: "live_end", watch: game.ref });
    assert.deepEqual(
      verifyInternal({ headers: kick.headers, method: "POST", path: KICK_PATH, body: kick.body, keys: WORKER_RING, nowMs: Date.now() }),
      { ok: true, kid: "ws" },
    );
    assert.deepEqual(
      [(await userStats(w.id)).version - versions[0]!, (await userStats(b.id)).version - versions[1]!],
      [1, 1],
      "gamesVersion once per member",
    );

    // The outbox's retry after a lost response: the same finish again.
    const s = session();
    const out = await server.booted.persistence.finish(s, s.state.result!);
    assert.equal(out.committed, true);
    assert.equal(out.analysis?.created, false);
    assert.equal(out.analysis?.status, "QUEUED");
    assert.equal((await jobsOf(game.id)).length, 1, "a replayed finish adds no job");
    assert.equal((await userStats(w.id)).version - versions[0]!, 1, "and no second bump");
    await until(() => kicksFor(game.ref).length === 2);
  });

  test("a short game (< 6 plies) and an abort: SKIPPED, no job, no kick; games:changed still goes out", async () => {
    const short = await startDbGame(server);
    const result = waitFor(short.W, "game:result", 5_000);
    const changed = waitFor(short.B, "games:changed", 5_000);
    let queuedSeen = false;
    short.W.on("analysis:queued", () => (queuedSeen = true));
    await playLine(short.W, short.B, short.game.ref, SIX.slice(0, 4));
    assert.deepEqual(await cmd(short.W, "game:resign", { ref: short.game.ref }), { ok: true });
    assert.deepEqual((await result).review, { status: "skipped", etaSec: null });
    await changed;
    assert.equal(await analysisStatus(short.game.id), "SKIPPED");
    assert.equal((await jobsOf(short.game.id)).length, 0);

    const ab = await startDbGame(server);
    const abChanged = waitFor(ab.W, "games:changed", 5_000);
    assert.equal((await move(ab.W, ab.game.ref, 0, "e2e4")).ok, true);
    assert.deepEqual(await cmd(ab.B, "game:abort", { ref: ab.game.ref }), { ok: true });
    await abChanged;
    const end = Date.now() + 5_000;
    while ((await analysisStatus(ab.game.id)) !== "SKIPPED" && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    assert.equal(await analysisStatus(ab.game.id), "SKIPPED");
    assert.equal((await jobsOf(ab.game.id)).length, 0);

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(kicksFor(short.game.ref).length + kicksFor(ab.game.ref).length, 0, "nothing to analyse: no kick");
    assert.equal(queuedSeen, false);
  });
});
