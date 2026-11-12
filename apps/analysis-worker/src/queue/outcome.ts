// What happens to a claimed job afterwards (phase-03 plan §8.12 "Failure", "Graceful SIGTERM"; §7.7 retries):
// done, failed (with back-off, or terminal), released (SIGTERM: not counted as an attempt), heart-beaten. Every
// statement is guarded by `"lockedBy" = me AND status = 'RUNNING'`, so a worker that lost its job to the reaper can
// never overwrite the new owner's state, and every statement is idempotent (safe to retry once, P3-D11).
//
// A failed or reaped ANALYZE_GAME also marks the game FAILED, records `game_analyses."failedAtPly"`, bumps the members'
// `users."gamesVersion"` (P3-D27) and returns the members' refs for `analysis:failed`: all in the same statement.
import { analysisFailedEvent } from "../socket/events";
import { idOrNull, idStr, num, numOrNull, stmt, type Row, type Statement } from "../db/client";
import { NOW } from "./claim";

/** Retry back-off by attempt number (1-based): 30 s, 2 min, 10 min (§7.7). Later attempts reuse the last value. */
export const BACKOFF_SEC = [30, 120, 600] as const;
/** The reaper's retry delay (§8.12). */
export const REAP_RETRY_SEC = 30;
/** A RUNNING job whose heartbeat is older than this is stalled (§8.12 reaper). */
export const REAP_STALE_SEC = 180;
/**
 * A row of another boot of this worker id is an orphan once its heartbeat is this old: 1.5 heartbeats (heartbeat.ts,
 * 30 s), so a crashed boot is reaped within ~45 s (owner test T11) while a live worker that shares the id (a
 * misconfiguration) keeps beating and is never reaped (FIX-2).
 */
export const ORPHAN_STALE_SEC = 45;
/** `jobs."lastError"` is varchar(1000). */
const LAST_ERROR_MAX = 1000;

export function backoffSec(attempt: number): number {
  const i = Math.max(1, Math.floor(attempt)) - 1;
  return BACKOFF_SEC[Math.min(i, BACKOFF_SEC.length - 1)]!;
}

/** `"<code>: <short message>"`; never PII (§11.2 rule 9). */
export function lastError(code: string, message: string): string {
  return `${code}: ${message}`.replace(/\s+/g, " ").slice(0, LAST_ERROR_MAX);
}

/** `j.payload->>'<key>'` as a bigint, or NULL when it is not an id (a bad payload must never break the statement). */
const payloadId = (key: string) =>
  `CASE WHEN j.payload->>'${key}' ~ '^[0-9]{1,18}$' THEN (j.payload->>'${key}')::bigint END`;

/**
 * The side effects of a failed/reaped job, appended after a CTE `j` that RETURNs the jobs rows:
 *   - ANALYZE_GAME: the game is marked FAILED, `failedAtPly` recorded, the members' archive version bumped;
 *   - LEGEND_COMPARE failed for good (`compare`: the reaper only; the runner's own failure path is the handler's
 *     `onFailed`): the member's comparison row becomes FAILED (`compareError`, $n) and the row returns the member's
 *     ref and the game ref for `compare:ready {status: "failed"}`. `compareAgain` also returns a row this very
 *     statement failed before (the reaper's retry form: same `error`).
 */
function failureEffects(compare: { errorParam: string; again: boolean } | null): string {
  const lc = compare
    ? `
, lc AS (
  UPDATE legend_comparisons c SET status = 'FAILED', error = ${compare.errorParam}, "updatedAt" = ${NOW}
    FROM j
   WHERE j.kind = 'LEGEND_COMPARE' AND j.status = 'FAILED'
     AND c."gameId" = ${payloadId("gameId")} AND c."userId" = ${payloadId("userId")}
     AND (c.status = 'FACTS_READY'${compare.again ? ` OR (c.status = 'FAILED' AND c.error = ${compare.errorParam})` : ""})
  RETURNING c."gameId", c."userId"
)`
    : "";
  const compareCols = compare
    ? `,
       (SELECT u."referenceId" FROM lc JOIN users u ON u.id = lc."userId"
         WHERE j.kind = 'LEGEND_COMPARE' AND lc."gameId" = ${payloadId("gameId")} AND lc."userId" = ${payloadId("userId")}) AS "compareMember",
       CASE WHEN j.kind = 'LEGEND_COMPARE' THEN j.payload->>'gameRef' END AS "compareGameRef"`
    : "";
  return `
, g AS (
  UPDATE games SET "analysisStatus" = 'FAILED', "updatedAt" = ${NOW}
    FROM j
   WHERE j.kind = 'ANALYZE_GAME' AND games.id = j."gameId"
     AND games."analysisStatus" IN ('QUEUED', 'RUNNING', 'FAILED')
  RETURNING games.id, games."referenceId" AS ref, games."plyCount" AS "plyCount"
), a AS (
  UPDATE game_analyses ga SET "failedAtPly" = ga."gradedPlies", "updatedAt" = ${NOW}
    FROM g
   WHERE ga."gameId" = g.id
  RETURNING ga."gameId", ga."gradedPlies"
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM game_players gp JOIN g ON g.id = gp."gameId"
   WHERE u.id = gp."userId"
  RETURNING u.id
)${lc}
SELECT j.id::text AS id, j.kind::text AS kind, j.status::text AS status, j.attempts, j."maxAttempts",
       j."gameId"::text AS "gameId", (extract(epoch FROM j."runAt") * 1000)::float8 AS "runAtMs",
       g.ref AS "gameRef", g."plyCount", a."gradedPlies",
       ARRAY(SELECT u."referenceId" FROM game_players gp JOIN users u ON u.id = gp."userId"
              WHERE gp."gameId" = g.id ORDER BY gp.color DESC) AS members,
       (SELECT count(*) FROM uv)::int AS bumped${compareCols}
  FROM j LEFT JOIN g ON g.id = j."gameId" LEFT JOIN a ON a."gameId" = g.id`;
}

const GAME_FAILURE_EFFECTS = failureEffects(null);

/** One job row a fail/reap statement changed, with what `analysis:failed` needs for an ANALYZE_GAME game. */
export interface FailedJob {
  id: string;
  kind: string;
  /** QUEUED (a retry is due at `runAtMs`) or FAILED (terminal). */
  status: "QUEUED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  runAtMs: number;
  gameId: string | null;
  /** Set when the job was an ANALYZE_GAME whose game was marked FAILED. */
  game: { ref: string; plyCount: number; gradedPlies: number; members: string[] } | null;
  /** Set when the reaper failed a LEGEND_COMPARE for good and marked the member's comparison FAILED. */
  compare: { gameRef: string; member: string } | null;
}

export function toFailedJob(row: Row): FailedJob {
  const ref = typeof row.gameRef === "string" ? row.gameRef : null;
  return {
    id: idStr(row.id),
    kind: String(row.kind),
    status: row.status === "FAILED" ? "FAILED" : "QUEUED",
    attempts: num(row.attempts),
    maxAttempts: num(row.maxAttempts),
    runAtMs: num(row.runAtMs),
    gameId: idOrNull(row.gameId),
    game: ref
      ? {
          ref,
          plyCount: num(row.plyCount),
          gradedPlies: numOrNull(row.gradedPlies) ?? 0,
          members: Array.isArray(row.members) ? row.members.map(String) : [],
        }
      : null,
    compare:
      typeof row.compareMember === "string" && typeof row.compareGameRef === "string"
        ? { gameRef: row.compareGameRef, member: row.compareMember }
        : null,
  };
}

/** The `analysis:failed` payload for a failed/reaped analysis (null for other kinds). */
export function failedEventOf(job: FailedJob, code: "engine_failed" | "worker_stalled" | "timeout" | "internal") {
  if (!job.game) return null;
  const retryable = job.status === "QUEUED";
  return analysisFailedEvent({
    gameRef: job.game.ref,
    gradedPlies: Math.min(job.game.gradedPlies, job.game.plyCount),
    totalPlies: job.game.plyCount,
    failedAtPly: Math.min(job.game.gradedPlies, job.game.plyCount),
    retryable,
    retryAt: retryable ? new Date(job.runAtMs).toISOString() : null,
    code,
  });
}

/**
 * A failed attempt: QUEUED again after the back-off, or FAILED when the attempts are used up (or `terminal`).
 * The statement returns 0 rows when this worker no longer holds the job.
 *
 * It clears `lockedBy`, so sending it again after a lost response would find the job "no longer ours" and drop the
 * `analysis:failed` emit. Its retry form (`retry`) also matches the row this very attempt already failed (the same
 * attempt number and `lastError`, no lock, not RUNNING) and returns it again; the game side effects are idempotent
 * apart from one more `gamesVersion` bump, which only invalidates a cached list (FIX-1, `outcome.int.test.ts`).
 */
export function failStatement(input: {
  jobId: string;
  me: string;
  code: string;
  message: string;
  attempt: number;
  terminal?: boolean;
}): Statement {
  const build = (alreadyFailedByMe: boolean): Statement => {
    const terminal = `(attempts >= "maxAttempts" OR $5::boolean)`;
    const mine = `("lockedBy" = $2 AND status = 'RUNNING')`;
    const again = `("lockedBy" IS NULL AND status IN ('QUEUED', 'FAILED') AND attempts = $6 AND "lastError" = $3)`;
    return stmt(
      `WITH j AS (
  UPDATE jobs
     SET status = CASE WHEN ${terminal} THEN 'FAILED' ELSE 'QUEUED' END::"JobStatus",
         "runAt" = CASE WHEN ${terminal} THEN "runAt" ELSE ${NOW} + ($4::int * interval '1 second') END,
         "finishedAt" = CASE WHEN ${terminal} THEN ${NOW} END,
         "lastError" = $3, "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL
   WHERE id = $1::bigint AND (${mine}${alreadyFailedByMe ? ` OR ${again}` : ""})
  RETURNING id, kind, status, attempts, "maxAttempts", "runAt", "gameId"
)${GAME_FAILURE_EFFECTS}`,
      [
        input.jobId,
        input.me,
        lastError(input.code, input.message),
        backoffSec(input.attempt),
        input.terminal === true,
        ...(alreadyFailedByMe ? [input.attempt] : []),
      ],
    );
  };
  return { ...build(false), retry: build(true) };
}

let reapSeq = 0;

/**
 * The reaper (§8.12; at boot and at the end of each drain, never on a timer): RUNNING jobs whose heartbeat is older
 * than 3 minutes, or that an earlier boot of this worker held (`lockedBy` = `<workerId>-<8-char boot id>`, not mine)
 * once their heartbeat is ORPHAN_STALE_SEC old: a live worker that shares this WORKER_ID keeps beating, so its jobs
 * are never taken from it (FIX-2; scheduler.ts re-checks a fresh earlier-boot row once it can be stale).
 * QUEUED again in 30 s, or FAILED when the attempts are used up. A LEGEND_COMPARE failed for good also fails the
 * member's comparison row and returns what `compare:ready {status: "failed"}` needs (regression:
 * reaped-compare-never-failed, FIX-2).
 *
 * `drainEnd`: the worker runs one job at a time and the drain has just finished its last one, so a RUNNING row this
 * very boot holds (`lockedBy` = me, never another boot's) is an orphan too (a fail or release write that failed, a
 * claim whose adoption failed): it is reaped at once instead of waiting 3 minutes for a later drain (FIX-1). At boot
 * no row can hold the new boot id.
 *
 * Every call writes its own token into `lastError` (and the comparison's `error`). The statement clears `lockedBy`,
 * so sending it again after a lost response would find nothing left to reap and the emits would never go out: its
 * retry form (`retry`) also returns the rows this very call already reaped, recognised by that token (regression:
 * lost-reap-response, FIX-2). Their game side effects are idempotent apart from one more `gamesVersion` bump.
 */
export function reapStatement(input: { workerId: string; me: string; drainEnd?: boolean; token?: string }): Statement {
  const token = input.token ?? `${input.me}#${++reapSeq}`;
  const build = (again: boolean): Statement =>
    stmt(
      `WITH j AS (
  UPDATE jobs
     SET status = CASE WHEN attempts >= "maxAttempts" THEN 'FAILED' ELSE 'QUEUED' END::"JobStatus",
         "runAt" = ${NOW} + interval '${REAP_RETRY_SEC} seconds',
         "finishedAt" = CASE WHEN attempts >= "maxAttempts" THEN ${NOW} END,
         "lastError" = $3, "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL
   WHERE (status = 'RUNNING'
          AND (COALESCE("heartbeatAt", "lockedAt", "startedAt") < ${NOW} - interval '${REAP_STALE_SEC} seconds'
               OR ("lockedBy" LIKE $1 ESCAPE '\\' AND "lockedBy" <> $2
                   AND COALESCE("heartbeatAt", "lockedAt", "startedAt") < ${NOW} - interval '${ORPHAN_STALE_SEC} seconds')
               OR ("lockedBy" = $2 AND $4::boolean)))${
            // The rows this call reaped: QUEUED due 30 s from the reap, or FAILED just now (the partial indexes
            // jobs_ready_idx and jobs_finished_idx answer it; explain-hot gates it).
            again
              ? `\n      OR ("lockedBy" IS NULL AND "lastError" = $3
          AND ((status = 'QUEUED' AND "runAt" > ${NOW}) OR (status = 'FAILED' AND "finishedAt" >= ${NOW} - interval '10 minutes')))`
              : ""
          }
  RETURNING id, kind, status, attempts, "maxAttempts", "runAt", "gameId", payload
)${failureEffects({ errorParam: "$3", again })}`,
      [
        orphanPattern(input.workerId),
        input.me,
        lastError("worker_stalled", `the worker holding it stopped (reap ${token})`),
        input.drainEnd === true,
      ],
    );
  return { ...build(false), retry: build(true) };
}

/**
 * RUNNING rows of other boots of this worker id that are still too fresh to reap (heartbeat newer than
 * ORPHAN_STALE_SEC): how many, and when the newest of them last beat. Read in the boot batch after the reaper: a
 * crashed earlier boot's row becomes reapable at `lastBeatMs + ORPHAN_STALE_SEC`, and a row that still beats then
 * belongs to a live worker sharing this WORKER_ID (scheduler.ts).
 */
export function freshSiblingsStatement(input: { workerId: string; me: string }): Statement {
  return stmt(
    `SELECT count(*)::int AS n,
            (extract(epoch FROM max(COALESCE("heartbeatAt", "lockedAt", "startedAt"))) * 1000)::float8 AS "lastBeatMs"
       FROM jobs
      WHERE status = 'RUNNING' AND "lockedBy" LIKE $1 ESCAPE '\\' AND "lockedBy" <> $2`,
    [orphanPattern(input.workerId), input.me],
  );
}

/** LIKE pattern for `<workerId>-<exactly 8 chars>` (the boot id), with the id's own `%`/`_`/`\` escaped. */
export function orphanPattern(workerId: string): string {
  return `${workerId.replace(/[\\%_]/g, (c) => `\\${c}`)}-________`;
}

/** The job is done (part of the handler's final batch, after lockGuardStatement). */
export function doneStatement(jobId: string, me: string, result: unknown = null): Statement {
  return stmt(
    `UPDATE jobs SET status = 'DONE', "finishedAt" = ${NOW}, "heartbeatAt" = ${NOW}, result = $3::jsonb
      WHERE id = $1::bigint AND "lockedBy" = $2 AND status = 'RUNNING'
  RETURNING id::text AS id`,
    [jobId, me, result === null ? null : JSON.stringify(result)],
  );
}

/** The job is DONE and this worker marked it so (doneStatement keeps `lockedBy`): a final batch that committed. */
export function doneByMeStatement(jobId: string, me: string): Statement {
  return stmt(`SELECT id::text AS id FROM jobs WHERE id = $1::bigint AND "lockedBy" = $2 AND status = 'DONE'`, [
    jobId,
    me,
  ]);
}

/**
 * The first statement of a batch that must only commit while this worker still holds the job (a checkpoint, the
 * final batch): it locks the job row and raises `division_by_zero` (SQLSTATE 22012) when the job is not RUNNING
 * under `me`, which rolls the whole transaction back. `isLockLost(error)` recognises it.
 */
export function lockGuardStatement(jobId: string, me: string): Statement {
  return stmt(
    `SELECT 1 / (SELECT count(*)::int FROM (SELECT 1 FROM jobs WHERE id = $1::bigint AND "lockedBy" = $2
                                              AND status = 'RUNNING' FOR UPDATE) held) AS held`,
    [jobId, me],
  );
}

export function isLockLost(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "22012";
}

/** Heartbeat (§8.12): returns the job's current priority, or no row when the job is no longer ours. */
export function heartbeatStatement(jobId: string, me: string): Statement {
  return stmt(
    `UPDATE jobs SET "heartbeatAt" = ${NOW}
      WHERE id = $1::bigint AND "lockedBy" = $2 AND status = 'RUNNING'
  RETURNING priority`,
    [jobId, me],
  );
}

/**
 * Release (graceful SIGTERM, or a payload written by a newer build): QUEUED again without counting the attempt.
 * A running analysis's game goes back to QUEUED. `delaySec` keeps a job this build cannot read from being
 * re-claimed in a loop.
 */
export function releaseStatement(jobId: string, me: string, delaySec = 0): Statement {
  return stmt(
    `WITH j AS (
  UPDATE jobs
     SET status = 'QUEUED', "runAt" = ${NOW} + ($3::int * interval '1 second'), attempts = GREATEST(attempts - 1, 0),
         "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL
   WHERE id = $1::bigint AND "lockedBy" = $2 AND status = 'RUNNING'
  RETURNING id, kind, "gameId"
), g AS (
  UPDATE games SET "analysisStatus" = 'QUEUED', "updatedAt" = ${NOW}
    FROM j
   WHERE j.kind = 'ANALYZE_GAME' AND games.id = j."gameId" AND games."analysisStatus" = 'RUNNING'
  RETURNING games.id
)
SELECT j.id::text AS id, (SELECT count(*) FROM g)::int AS "gamesRequeued" FROM j`,
    [jobId, me, Math.max(0, Math.floor(delaySec))],
  );
}
