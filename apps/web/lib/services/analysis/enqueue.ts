// A3 requestAnalysis and A4 retryAnalysis (phase-03 plan §7.2, §7.3, §7.6; P3-D23, P3-D26).
//
// A3: the shared enqueue statement (`enqueueAnalysis` in @repo/db/jobs: the job upsert at USER_OPENED, the
// NONE → QUEUED flip and the members' gamesVersion bump in ONE statement), then, after the commit, a kick with
// `watch: ref` (so a backlog job streams progress) and `analysis:queued` to both member players.
//   created / updated → 202 queued|running · unchanged DONE → 200 done · unchanged FAILED|CANCELLED → 410 gone ·
//   ineligible (under 6 plies, aborted, not finished) → 409 skipped. A regrade revives a DONE job only when its
//   grading version is older than GRADING_VERSION (the engine-free regrade, P3-D28); otherwise it is a no-op `done`.
// A4: pulls a QUEUED job with attempts left to now (attempts are NOT reset) and flips FAILED → QUEUED; 0 rows → the
//   job's state decides: RUNNING 409 already_running, DONE (or none) 409 not_failed, terminal 410 gone.
// A non-player admin's write is a 204 no-op (support never queues work on someone's game).
import { GRADING_VERSION } from "@repo/chess-analysis/version";
import type { AnalyseResponse, RetryResponse } from "@repo/contracts/http/review";
import { ANALYSIS_MIN_PLIES, JOB_PRIORITY, analyzeDedupeKey } from "@repo/contracts/internal/jobs";
import { Prisma } from "@repo/db";
import { enqueueAnalysis, type EnqueuedJob } from "@repo/db/jobs";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { emitAnalysisQueued } from "./emit";
import { kickWorker } from "./kick";
import { isAdmin } from "./reader";
import { etaSecFor } from "./state";
import { captureReviewServerEvent } from "./telemetry";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

/** What A3/A4 read first: the player check, eligibility, the member refs for the emit and the job state. */
export type EnqueueTarget = {
  gameId: bigint;
  ref: string;
  gameStatus: string;
  plyCount: number;
  analysisStatus: "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  mode: string | null;
  source: string;
  version: number | null;
  gradedPlies: number | null;
  totalPlies: number | null;
  isPlayer: boolean;
  memberRefs: string[];
  jobStatus: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | null;
  attempts: number | null;
  maxAttempts: number | null;
};

export function enqueueTargetSql(viewerId: bigint, ref: string): Prisma.Sql {
  return Prisma.sql`SELECT g.id AS "gameId", g."referenceId" AS ref, g.status::text AS "gameStatus", g."plyCount",
       g."analysisStatus"::text AS "analysisStatus", g.mode::text AS mode, g.source::text AS source,
       a.version, a."gradedPlies", a."totalPlies", (me."userId" IS NOT NULL) AS "isPlayer",
       (SELECT COALESCE(json_agg(u."referenceId" ORDER BY p.color DESC), '[]'::json)
          FROM game_players p JOIN users u ON u.id = p."userId" WHERE p."gameId" = g.id) AS "memberRefs",
       j.status::text AS "jobStatus", j.attempts, j."maxAttempts"
  FROM games g
  LEFT JOIN game_players me ON me."gameId" = g.id AND me."userId" = ${viewerId}
  LEFT JOIN game_analyses a ON a."gameId" = g.id
  LEFT JOIN jobs j ON j."dedupeKey" = 'analyze:' || g.id
 WHERE g."referenceId" = ${ref}`;
}

/** The target, or: 404 (unknown game / non-player), "admin_noop" (a non-player admin). */
export async function enqueueTarget(db: GamesDb, viewer: Pick<Viewer, "id" | "role">, ref: string): Promise<EnqueueTarget | "admin_noop"> {
  const rows = await db.$queryRaw<EnqueueTarget[]>(enqueueTargetSql(viewer.id, ref));
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  if (!row.isPlayer) {
    if (isAdmin(viewer)) return "admin_noop";
    throw new DataError("not_found");
  }
  return row;
}

/** Jobs ahead of a QUEUED job in the claim order (jobs_ready_idx). */
export function queueAheadSql(jobId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT count(*)::int AS ahead FROM jobs q, jobs j
 WHERE j.id = ${jobId} AND q.status = 'QUEUED' AND q.id <> j.id AND q."runAt" <= ${NOW}
   AND (q.priority > j.priority OR (q.priority = j.priority AND (q."fairSeq", q."runAt", q.id) < (j."fairSeq", j."runAt", j.id)))`;
}

async function queueAhead(db: GamesDb, jobId: bigint): Promise<number> {
  const rows = await db.$queryRaw<{ ahead: number }[]>(queueAheadSql(jobId));
  return Math.max(0, Number(rows[0]?.ahead ?? 0));
}

type AfterCtx = { after: (task: () => unknown) => void };

const MODE_WIRE: Record<string, "online" | "friend" | "bot" | "legend_bot" | "tournament" | "imported"> = {
  ONLINE: "online",
  FRIEND: "friend",
  BOT: "bot",
  LEGEND_BOT: "legend_bot",
  TOURNAMENT: "tournament",
  IMPORTED: "imported",
};
const SOURCE_WIRE: Record<string, "replay" | "chesscom" | "lichess"> = { REPLAY: "replay", CHESSCOM: "chesscom", LICHESS: "lichess" };

export type AnalyseOutcome = { status: 202 | 200; body: AnalyseResponse } | { status: 204 };

function totalOf(t: EnqueueTarget): number {
  return Math.max(0, t.totalPlies ?? t.plyCount);
}

/** A3. */
export async function requestAnalysis(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role" | "ref">,
  ref: string,
  reason: "opened" | "regrade",
  ctx: AfterCtx,
): Promise<AnalyseOutcome> {
  const target = await enqueueTarget(db, viewer, ref);
  if (target === "admin_noop") return { status: 204 };
  const eligible =
    target.analysisStatus !== "SKIPPED" && target.gameStatus === "COMPLETED" && target.plyCount >= ANALYSIS_MIN_PLIES;
  if (!eligible) throw new ApiError("conflict", { details: { reason: "skipped" } });
  const regrade = reason === "regrade" && target.analysisStatus === "DONE" && (target.version ?? GRADING_VERSION) < GRADING_VERSION;
  const result = await enqueueAnalysis(db, {
    gameId: target.gameId,
    gameRef: target.ref,
    priority: JOB_PRIORITY.USER_OPENED,
    reason: regrade ? "regrade" : "opened",
  });
  if (result.outcome === "ineligible") throw new ApiError("conflict", { details: { reason: "skipped" } });
  if (result.outcome === "unchanged") {
    if (result.job.status === "DONE") return { status: 200, body: { status: "done", position: 0, etaSec: 0 } };
    throw new ApiError("gone", { details: { reason: "terminal" } });
  }
  const job = result.job;
  const total = totalOf(target);
  const graded = Math.min(total, target.gradedPlies ?? 0);
  const running = job.status === "RUNNING";
  const position = running ? 0 : await queueAhead(db, job.id);
  const body: AnalyseResponse = {
    status: running ? "running" : "queued",
    position,
    etaSec: etaSecFor({ position, totalPlies: total, gradedPlies: regrade ? 0 : graded }),
  };
  scheduleAfterEnqueue(ctx, {
    job,
    ref: target.ref,
    memberRefs: target.memberRefs,
    kickReason: regrade ? "regrade" : "opened",
    position,
    etaSec: body.etaSec,
  });
  if (result.outcome === "created") {
    ctx.after(() =>
      captureReviewServerEvent(
        "analysis_queued",
        {
          game_mode: MODE_WIRE[target.mode ?? ""] ?? "online",
          source: SOURCE_WIRE[target.source] ?? "replay",
          reason: regrade ? "regrade" : "opened",
          priority: JOB_PRIORITY.USER_OPENED,
          queue_position: Math.min(100_000, position),
        },
        viewer.ref,
      ),
    );
  }
  return { status: 202, body };
}

function scheduleAfterEnqueue(
  ctx: AfterCtx,
  input: {
    job: Pick<EnqueuedJob, "runAt">;
    ref: string;
    memberRefs: string[];
    kickReason: "opened" | "regrade" | "retry";
    position: number;
    etaSec: number;
  },
): void {
  ctx.after(async () => {
    await kickWorker({ v: 1, reason: input.kickReason, watch: input.ref, runAt: input.job.runAt.toISOString() });
    await emitAnalysisQueued(input.memberRefs, { gameRef: input.ref, position: input.position, etaSec: input.etaSec });
  });
}

// ── A4 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function retrySql(gameId: bigint): Prisma.Sql {
  return Prisma.sql`WITH j AS (
  UPDATE jobs SET "runAt" = ${NOW}, priority = GREATEST(priority, ${JOB_PRIORITY.USER_OPENED}::smallint), "lastKickAt" = ${NOW}
   WHERE "dedupeKey" = ${analyzeDedupeKey(gameId)} AND status = 'QUEUED' AND attempts < "maxAttempts"
  RETURNING id, (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs"
), g AS (
  UPDATE games SET "analysisStatus" = 'QUEUED' FROM j
   WHERE games.id = ${gameId} AND games."analysisStatus" = 'FAILED'
  RETURNING games.id
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM game_players gp JOIN g ON g.id = gp."gameId"
   WHERE u.id = gp."userId"
  RETURNING u.id
)
SELECT j.id, j."runAtMs", (SELECT count(*) FROM g)::int AS changed FROM j`;
}

export type RetryOutcome = { status: 202; body: RetryResponse } | { status: 204 };

/** A4. */
export async function retryAnalysis(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  ctx: AfterCtx,
): Promise<RetryOutcome> {
  const target = await enqueueTarget(db, viewer, ref);
  if (target === "admin_noop") return { status: 204 };
  const rows = await db.$queryRaw<{ id: bigint; runAtMs: number }[]>(retrySql(target.gameId));
  const row = rows[0];
  if (!row) {
    switch (target.jobStatus) {
      case "RUNNING":
        throw new ApiError("conflict", { details: { reason: "already_running" } });
      case "FAILED":
      case "CANCELLED":
      case "QUEUED":
        // A QUEUED job that no longer matched has used its attempts (or was claimed meanwhile and finished).
        throw new ApiError("gone", { details: { reason: "terminal" } });
      default:
        throw new ApiError("conflict", { details: { reason: "not_failed" } });
    }
  }
  const total = totalOf(target);
  const resumeFromPly = Math.min(total, Math.max(0, target.gradedPlies ?? 0));
  const position = await queueAhead(db, BigInt(row.id));
  const etaSec = etaSecFor({ position, totalPlies: total, gradedPlies: resumeFromPly });
  scheduleAfterEnqueue(ctx, {
    job: { runAt: new Date(Math.round(Number(row.runAtMs))) },
    ref: target.ref,
    memberRefs: target.memberRefs,
    kickReason: "retry",
    position,
    etaSec,
  });
  return { status: 202, body: { status: "queued", resumeFromPly, etaSec } };
}
