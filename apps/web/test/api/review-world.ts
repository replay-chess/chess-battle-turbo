// The database world of the P3 review route tests (phase-03 plan §12.2): users A (White, player), B (a member who is
// not a player), C (admin) and D (Black, player), and one game per review state (done, none, a stale QUEUED job,
// skipped, failed retryable, failed terminal, running, a stalled worker, two legend games from the Opera position).
// Used by test/api/review.contract.int.test.ts and test/authz/review.authz.int.test.ts. Throwaway Docker Postgres
// only (TEST_DATABASE_URL): it creates and deletes its own rows.
import { randomBytes } from "node:crypto";
import { fixtureReview, gameAnalysisInput } from "@repo/chess-analysis/fixtures/review-inputs";
import { gradeAnalysis } from "@repo/chess-analysis/analysis";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { PrismaClient } from "@repo/db";
import { buildReviewContent } from "@repo/db/json";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request, viewerFixture } from "../helpers/route-harness";
import { createWithFreeFen } from "../helpers/unique-fen";

export const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const OPERA_START = "rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10";
const OPERA_PGN =
  '[Event "Paris"]\n[White "Paul Morphy"]\n[Black "Duke Karl / Count Isouard"]\n[Result "1-0"]\n\n' +
  "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 " +
  "11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0";
/** The member follows Morphy for two moves, then plays 12.Ba4 (CA fixtures/legend/opera.json). */
const OPERA_GAME_UCI = "c3b5 c6b5 c4b5 b8d7 b5a4 a8b8 a4b5 b8a8 b5a4 a8b8 a4b5 b8a8 b5a4";

export type Handlers = { GET?: RouteHandler; POST?: RouteHandler; PATCH?: RouteHandler; DELETE?: RouteHandler };
export type Who = "a" | "b" | "c" | "d";
export type HandlerName = "review" | "status" | "analyse" | "retry" | "progress" | "moment" | "complete" | "pgn" | "legend" | "compute";

export function reviewWorld(url: string) {
  let db!: PrismaClient;
  // Unique per process: the contract and authz files run in parallel against the same database.
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const users = {} as Record<Who, { id: bigint; ref: string; name: string; admin: boolean }>;
  const games: Record<string, { id: bigint; ref: string }> = {};
  const H = {} as Record<HandlerName, Handlers>;
  const kicks: { url: string; body: unknown }[] = [];
  const emits: { url: string; body: { targets: { userRef: string }[]; event: string; data: Record<string, unknown> } }[] = [];
  let restoreKick: () => void;
  let positionId: bigint | null = null;
  let restoreEmit: () => void;
  const game = analysisFixture();

  function analysisFixture() {
    const input = gameAnalysisInput();
    const graded = gradeAnalysis(input);
    return { input, graded, moves: input.moves.join(" "), review: buildReviewContent(fixtureReview("GAME")) };
  }

  const viewerOf = (who: Who) =>
    viewerFixture({
      id: users[who].id,
      ref: users[who].ref,
      role: users[who].admin ? "admin" : "user",
      user: { name: users[who].name },
    });

  async function call(
    h: Handlers,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    who: Who,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      params?: Record<string, string>;
      /** Another viewer state for the same user (authz: never a member, trial used, lapsed). */
      viewer?: Viewer | null;
      signedOut?: boolean;
      /** The real fixed-window limiter (rate_limit_buckets) instead of the always-allow stub. */
      realRateLimit?: boolean;
      clerkUserId?: string;
    } = {},
  ) {
    const realLimiter = init.realRateLimit ? (await import("@/lib/rate-limit-db")).checkRateLimit : undefined;
    // The real clock: the rows below are written with the database's now(), and the stall rule and the kick CAS compare
    // them with ctx.now.
    const t = installTestDeps({
      userId: init.signedOut ? null : (init.clerkUserId ?? `user_${who}`),
      ...(realLimiter ? { overrides: { checkRateLimit: realLimiter } } : {}),
      viewer: init.signedOut ? null : init.viewer === undefined ? viewerOf(who) : init.viewer,
      env: { ROUTE_VALIDATE_RESPONSES: "1" },
      clock: Date.now(),
    });
    try {
      const handler = h[method]!;
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      const res = await handler(
        request(path, { method, headers: { "content-type": "application/json", ...init.headers }, body }),
        noParams(init.params ?? {}),
      );
      return { res, recorded: t.recorded };
    } finally {
      t.restore();
    }
  }

  const get = (h: Handlers, ref: string, who: Who, suffix = "", headers: Record<string, string> = {}) =>
    call(h, "GET", `/api/review/${ref}${suffix}`, who, { params: { ref }, headers });

  /** Runs the request's `after()` tasks the way Next does: after the response, with the same route deps. */
  async function runAfter(recorded: { afterTasks: (() => unknown)[] }) {
    const tasks = recorded.afterTasks.splice(0);
    const t = installTestDeps({ clock: Date.now() });
    try {
      for (const task of tasks) await task();
    } finally {
      t.restore();
    }
  }

  async function jobs(gameId: bigint) {
    return db.job.findMany({ where: { gameId }, orderBy: { id: "asc" } });
  }

  async function createGame(
    key: string,
    opts: {
      moves?: string;
      plyCount?: number;
      analysisStatus?: "NONE" | "QUEUED" | "DONE" | "FAILED" | "SKIPPED";
      startingFen?: string;
      startPly?: number;
      mode?: "ONLINE" | "LEGEND_BOT";
      chessPositionId?: bigint | null;
      blackMember?: boolean;
      outcome?: "WHITE" | "BLACK" | "DRAW";
    } = {},
  ) {
    const moves = opts.moves ?? game.moves;
    const plyCount = opts.plyCount ?? (moves ? moves.split(" ").length : 0);
    const blackMember = opts.blackMember ?? true;
    const endedAt = new Date();
    const g = await db.game.create({
      data: {
        creatorId: users.a.id,
        opponentId: blackMember ? users.d.id : null,
        status: "COMPLETED",
        startingFen: opts.startingFen ?? INITIAL,
        startPly: opts.startPly ?? 0,
        initialTimeSeconds: 600,
        incrementSeconds: 0,
        creatorTimeRemaining: 600,
        opponentTimeRemaining: 600,
        expiresAt: new Date(Date.now() + 86_400_000),
        mode: opts.mode ?? "ONLINE",
        timeClass: "RAPID",
        whitePlayerId: users.a.id,
        blackPlayerId: blackMember ? users.d.id : null,
        moves,
        plyCount,
        outcome: opts.outcome ?? "BLACK",
        endMethod: "RESIGNATION",
        completedAt: endedAt,
        analysisStatus: opts.analysisStatus ?? "NONE",
        chessPositionId: opts.chessPositionId ?? null,
        ecoCode: "C59",
        openingName: "Two Knights Defense",
        botElo: blackMember ? null : 1400,
      },
      select: { id: true, referenceId: true },
    });
    const result = (side: "w" | "b") =>
      opts.outcome === "DRAW" ? "DRAW" : (opts.outcome ?? "BLACK") === (side === "w" ? "WHITE" : "BLACK") ? "WIN" : "LOSS";
    await db.gamePlayer.create({
      data: {
        gameId: g.id,
        userId: users.a.id,
        color: "w",
        mode: opts.mode ?? "ONLINE",
        timeClass: "RAPID",
        result: result("w"),
        endedAt,
        opponentUserId: blackMember ? users.d.id : null,
        opponentName: blackMember ? users.d.name : "Engine 1400",
        opponentRating: blackMember ? 1203 : 1400,
        ratingBefore: 1184,
      },
    });
    if (blackMember) {
      await db.gamePlayer.create({
        data: {
          gameId: g.id,
          userId: users.d.id,
          color: "b",
          mode: opts.mode ?? "ONLINE",
          timeClass: "RAPID",
          result: result("b"),
          endedAt,
          opponentUserId: users.a.id,
          opponentName: users.a.name,
          opponentRating: 1184,
          ratingBefore: 1203,
        },
      });
    }
    games[key] = { id: g.id, ref: g.referenceId };
    return games[key]!;
  }

  async function writeAnalysis(gameId: bigint, opts: { graded?: number; done?: boolean; version?: number } = {}) {
    const total = game.graded.totalPlies;
    const graded = opts.graded ?? total;
    const done = opts.done ?? graded === total;
    await db.gameAnalysis.create({
      data: {
        gameId,
        version: opts.version ?? 1,
        engine: "sf18-test/sf18-v1",
        nodesPass1: 120_000,
        nodesPass2: 1_000_000,
        totalPlies: total,
        gradedPlies: graded,
        evals: game.input.evals.slice(0, graded + 1) as number[],
        second: [],
        best: (game.input.best as number[]).slice(0, graded),
        judgements: game.graded.judgements.slice(0, graded),
        countsWhite: done ? game.graded.counts.w : [],
        countsBlack: done ? game.graded.counts.b : [],
        accuracyWhite: done ? game.graded.accuracy.w : null,
        accuracyBlack: done ? game.graded.accuracy.b : null,
        depthP50: 18,
        completedAt: done ? new Date() : null,
      },
    });
    if (done) {
      await db.playerReview.create({ data: { gameId, color: "w", content: game.review, textStatus: "TEMPLATE" } });
      await db.gamePlayer.updateMany({
        where: { gameId, color: "w" },
        data: {
          accuracy: game.graded.accuracy.w,
          momentsCount: game.review.moments.length,
          headline: game.review.headline,
          phaseAccuracy: [90, 70, -1],
        },
      });
    }
  }

  async function writeJob(
    gameId: bigint,
    ref: string,
    job: { status: "QUEUED" | "RUNNING" | "DONE" | "FAILED"; attempts?: number; runAtMs?: number; heartbeatAtMs?: number; lastError?: string },
  ) {
    await db.job.create({
      data: {
        kind: "ANALYZE_GAME",
        status: job.status,
        priority: JOB_PRIORITY.GAME_ENDED,
        dedupeKey: `analyze:${gameId}`,
        gameId,
        payload: { v: 1, gameId: gameId.toString(), gameRef: ref, reason: "live_end" },
        runAt: new Date(job.runAtMs ?? Date.now()),
        attempts: job.attempts ?? 0,
        maxAttempts: 4,
        heartbeatAt: job.heartbeatAtMs ? new Date(job.heartbeatAtMs) : null,
        lockedBy: job.status === "RUNNING" ? "test-worker-1" : null,
        lastError: job.lastError ?? null,
      },
    });
  }

  async function setup() {
    process.env.ANALYSIS_WORKER_URL = "http://worker.test:3003";
    // `web` signs socket emits, `webwk` the worker kicks (FIX-1: the worker never holds the socket key).
    process.env.INTERNAL_API_SECRET = `web:${Buffer.alloc(32, 7).toString("base64")},webwk:${Buffer.alloc(32, 8).toString("base64")}`;
    db = new PrismaClient({ datasourceUrl: url });
    const names: Record<Who, string> = { a: "Review A", b: "Review B", c: "Review Admin", d: "Review D" };
    for (const who of ["a", "b", "c", "d"] as const) {
      const u = await db.user.create({
        data: {
          googleId: `user_rint_${who}_${run}`,
          email: `rint-${who}-${run}@example.test`,
          name: names[who],
          code: `R${who}${run.slice(-4)}`.toUpperCase(),
          role: who === "c" ? "ADMIN" : "USER",
        },
        select: { id: true, referenceId: true, name: true },
      });
      users[who] = { id: u.id, ref: u.referenceId, name: u.name, admin: who === "c" };
    }
    const { setEmitTransport } = await import("@/lib/services/analysis/emit");
    restoreEmit = setEmitTransport(async (target, init) => {
      emits.push({ url: String(target), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ delivered: 1 }), { status: 202 });
    });
    const { setKickTransport } = await import("@/lib/services/analysis/kick");
    restoreKick = setKickTransport(async (target, init) => {
      kicks.push({ url: target, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ draining: true, nextRunAt: null }), { status: 202 });
    });
    H.review = (await import("@/app/api/review/[ref]/route")) as Handlers;
    H.status = (await import("@/app/api/review/[ref]/status/route")) as Handlers;
    H.analyse = (await import("@/app/api/review/[ref]/analyse/route")) as Handlers;
    H.retry = (await import("@/app/api/review/[ref]/retry/route")) as Handlers;
    H.progress = (await import("@/app/api/review/[ref]/progress/route")) as Handlers;
    H.moment = (await import("@/app/api/review/[ref]/moments/[ply]/route")) as Handlers;
    H.complete = (await import("@/app/api/review/[ref]/complete/route")) as Handlers;
    H.pgn = (await import("@/app/api/review/[ref]/pgn/route")) as Handlers;
    H.legend = (await import("@/app/api/review/[ref]/legend/route")) as Handlers;
    H.compute = (await import("@/app/api/review/[ref]/legend/compute/route")) as Handlers;

    const done = await createGame("done", { analysisStatus: "DONE" });
    await writeAnalysis(done.id);
    await writeJob(done.id, done.ref, { status: "DONE", attempts: 1 });
    await createGame("none");
    const stale = await createGame("stale", { analysisStatus: "QUEUED" });
    await writeJob(stale.id, stale.ref, { status: "QUEUED", runAtMs: Date.now() - 120_000 });
    await createGame("short", { moves: "e2e4 e7e5 g1f3 b8c6", analysisStatus: "SKIPPED" });
    // A short game the finish statement never marked (finished before P3; NONE, no job): read as skipped.
    await createGame("shortNone", { moves: "e2e4 e7e5" });
    const failed = await createGame("failed", { analysisStatus: "FAILED" });
    await writeAnalysis(failed.id, { graded: 20, done: false });
    await writeJob(failed.id, failed.ref, { status: "QUEUED", attempts: 1, runAtMs: Date.now() + 30_000, lastError: "engine_failed: no bestmove" });
    const terminal = await createGame("terminal", { analysisStatus: "FAILED" });
    await writeJob(terminal.id, terminal.ref, { status: "FAILED", attempts: 4, lastError: "engine_failed: crashed twice" });
    const running = await createGame("running", { analysisStatus: "QUEUED" });
    await writeAnalysis(running.id, { graded: 10, done: false });
    await writeJob(running.id, running.ref, { status: "RUNNING", attempts: 1, heartbeatAtMs: Date.now() - 5_000 });
    const stalled = await createGame("stalled", { analysisStatus: "QUEUED" });
    await writeJob(stalled.id, stalled.ref, { status: "RUNNING", attempts: 1, heartbeatAtMs: Date.now() - 120_000 });

    // chess_positions.fen is unique: a free halfmove clock (the comparison matches placement + side only).
    const pos = await createWithFreeFen(OPERA_START, (fen) => db.chessPosition.create({
      data: {
        fen,
        sideToMove: "white",
        pgn: OPERA_PGN,
        moveNumber: 10,
        whitePlayerName: "Paul Morphy",
        blackPlayerName: "Duke Karl / Count Isouard",
        tournamentName: "Paris Opera",
        eventDate: new Date("1858-11-02T00:00:00Z"),
        explanation: { fen: OPERA_START, segments: [{ visuals: [], narration: "Morphy develops with tempo.", startTime: 0, endTime: 2 }] },
      },
      select: { id: true },
    }));
    positionId = pos.id;
    for (const key of ["legend", "legend2"]) {
      const g = await createGame(key, {
        moves: OPERA_GAME_UCI,
        startingFen: OPERA_START,
        startPly: 18,
        mode: "LEGEND_BOT",
        chessPositionId: pos.id,
        blackMember: false,
        outcome: "DRAW",
        analysisStatus: "DONE",
      });
      await writeJob(g.id, g.ref, { status: "DONE", attempts: 1 });
    }
  }

  async function teardown() {
    restoreKick?.();
    restoreEmit?.();
    if (!db) return;
    const ids = Object.values(users).map((u) => u.id);
    const gameIds = Object.values(games).map((g) => g.id);
    await db.job.deleteMany({ where: { gameId: { in: gameIds } } });
    await db.game.deleteMany({ where: { id: { in: gameIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    if (positionId !== null) await db.chessPosition.deleteMany({ where: { id: positionId } });
    await db.$disconnect();
  }

  return {
    get db() {
      return db;
    },
    run,
    users,
    games,
    H,
    kicks,
    emits,
    viewerOf,
    call,
    get,
    runAfter,
    jobs,
    createGame,
    writeAnalysis,
    writeJob,
    setup,
    teardown,
  };
}

export type ReviewWorld = ReturnType<typeof reviewWorld>;
