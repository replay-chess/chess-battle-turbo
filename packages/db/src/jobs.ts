// The shared enqueue SQL for the `jobs` queue (phase-03 plan 7.6, 6.2; P3-D7, P3-D23, P3-D27). Every enqueue in
// every phase goes through this file, so the dedupe and priority rules live in one place:
//
//   enqueueJob(db, input)      any kind, one INSERT … ON CONFLICT ("dedupeKey") with a named conflict policy
//   enqueueAnalysis(db, input) ANALYZE_GAME for one finished game: the job upsert, the games."analysisStatus"
//                              flip and the members' users."gamesVersion" bump, in ONE statement
//
// Each has a `*Sql` builder returning a Prisma.Sql, so a caller can run it inside a batch transaction
// (`db.$transaction([...])`), embed enqueueJobSql() as a CTE body (A9b's attempts CTE), EXPLAIN it, or execute it
// through another driver: the analysis worker sends `sql.text` / `sql.values` over the Neon HTTP driver (P3-D11).
// Results are mapped driver-neutrally (ids may come back as bigint or string, times as epoch ms).
//
// Priorities are JOB_PRIORITY names only (higher runs first; CT/internal/jobs.ts, re-exported here): a priority
// that is not one of its values throws. The SQL writes (now() AT TIME ZONE 'UTC') because Prisma DateTime columns
// are timestamp(3) without zone, stored in UTC; nothing here depends on the session TimeZone.
import { Prisma } from "#generated";
import {
  ANALYSIS_MIN_PLIES,
  AnalyzeGamePayloadV1,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  JOB_PRIORITY,
  JOB_STATUSES,
  analyzeDedupeKey,
  type AnalyzeReason,
  type JobKind,
  type JobPriority,
  type JobStatus,
} from "@repo/contracts/internal/jobs";
import type { SqlClient } from "./live/types";

export {
  ANALYSIS_MIN_PLIES,
  JOB_KINDS,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  JOB_STATUSES,
  PROGRESS_BAND_MIN,
  analyzeDedupeKey,
  housekeepingDedupeKey,
  legendDedupeKey,
} from "@repo/contracts/internal/jobs";
export type { AnalyzeReason, JobKind, JobPriority, JobPriorityName, JobStatus } from "@repo/contracts/internal/jobs";

/** The DB default of jobs."maxAttempts" (schema.prisma), for kinds without a JOB_MAX_ATTEMPTS entry. */
const DEFAULT_MAX_ATTEMPTS = 4;
const DEDUPE_KEY_MAX = 120;
const PRIORITY_VALUES: ReadonlySet<number> = new Set(Object.values(JOB_PRIORITY));

/**
 * What happens when a row with the same `dedupeKey` already exists. "Live" = QUEUED or RUNNING; "terminal" = DONE,
 * FAILED or CANCELLED.
 *
 * - `keep`: leave the existing row alone (`DO NOTHING`). DAILY_PLAN's timed rows, backfills.
 * - `raise`: a live row gets max(priority) and min(fairSeq), and a fresh QUEUED row (attempts = 0) min(runAt);
 *   a backed-off QUEUED row (attempts > 0) keeps its runAt (only A4 Retry pulls a back-off forward) and a RUNNING
 *   row keeps everything else (the worker re-reads the priority at its next checkpoint: the band switch). Terminal
 *   rows are left alone, except DONE rows when `reviveDone` is set (regrade), which are revived.
 * - `requeue`: every non-RUNNING row is reset to QUEUED with the new payload, runAt and attempts = 0 (P4's
 *   IMPORT_SYNC re-link). A RUNNING row is left alone.
 *
 * A revived terminal row takes the NEW priority, fairSeq and maxAttempts (a HOUSEKEEPING regrade of a game that
 * was once analysed at GAME_ENDED must not jump the queue at 80) and loses its old run state (lockedBy, lockedAt,
 * heartbeatAt, lastError, result, startedAt, finishedAt).
 */
export type ConflictPolicy = "keep" | "raise" | "requeue";

/** Base payload shape every job carries (P3 kinds are validated against their CT schema). */
export type JobPayloadInput = { v: number } & Record<string, unknown>;

export interface EnqueueJobInput {
  kind: JobKind;
  /** One of JOB_PRIORITY's values (higher runs first). */
  priority: JobPriority;
  payload: JobPayloadInput;
  /** Natural key ("analyze:<gameId>", "legend:<g>:<u>", "housekeeping:<day>"); null = always a new row. */
  dedupeKey?: string | null;
  userId?: bigint | null;
  gameId?: bigint | null;
  /** Earliest start; default now. */
  runAt?: Date | null;
  /** Per-user ordinal inside a batch (ARCH §1.10.4); default 0. */
  fairSeq?: number;
  /** Default JOB_MAX_ATTEMPTS[kind], else the column default (4). */
  maxAttempts?: number;
  /** Default `keep`. */
  onConflict?: ConflictPolicy;
  /** With `raise`: also revive a DONE row (the regrade path). */
  reviveDone?: boolean;
  /** Optional guard: the row is inserted only when this boolean SQL expression is true (e.g. `EXISTS (SELECT 1 FROM lc)`). */
  when?: Prisma.Sql;
}

/** A row the statement inserted or updated (RETURNING), or the existing row it left alone. */
export interface EnqueuedJob {
  id: bigint;
  status: JobStatus;
  priority: number;
  runAt: Date;
  attempts: number;
  /** true: this statement inserted the row. */
  created: boolean;
}

interface JobRow {
  id: bigint | number | string;
  status: string;
  priority: number | string;
  runAtMs: number | string;
  attempts: number | string;
  created: boolean;
}

/** Columns every enqueue statement returns, driver-neutral (runAt as epoch ms of the UTC timestamp). */
const RETURNING = Prisma.sql`id, status::text AS status, priority, attempts,
  (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs", (xmax = 0) AS created`;

function toJob(row: JobRow): EnqueuedJob {
  if (!(JOB_STATUSES as readonly string[]).includes(row.status)) throw new Error(`jobs: unknown status ${row.status}`);
  return {
    id: BigInt(row.id),
    status: row.status as JobStatus,
    priority: Number(row.priority),
    runAt: new Date(Math.round(Number(row.runAtMs))),
    attempts: Number(row.attempts),
    created: row.created === true,
  };
}

function utcTimestamp(at: Date | null | undefined): Prisma.Sql {
  if (!at) return Prisma.sql`(now() AT TIME ZONE 'UTC')`;
  if (Number.isNaN(at.getTime())) throw new Error("jobs: runAt is an invalid Date");
  return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

function validate(input: EnqueueJobInput): { payload: JobPayloadInput; maxAttempts: number; fairSeq: number } {
  if (!(JOB_KINDS as readonly string[]).includes(input.kind)) throw new Error(`jobs: unknown kind ${input.kind}`);
  if (!PRIORITY_VALUES.has(input.priority)) {
    throw new Error(`jobs: priority ${String(input.priority)} is not a JOB_PRIORITY value`);
  }
  const fairSeq = input.fairSeq ?? 0;
  if (!Number.isInteger(fairSeq) || fairSeq < 0 || fairSeq > 2_147_483_647) throw new Error("jobs: fairSeq must be a non-negative int");
  if (input.dedupeKey != null && (input.dedupeKey.length === 0 || input.dedupeKey.length > DEDUPE_KEY_MAX)) {
    throw new Error(`jobs: dedupeKey must be 1..${DEDUPE_KEY_MAX} chars`);
  }
  if (input.reviveDone && input.onConflict !== "raise") throw new Error("jobs: reviveDone needs onConflict 'raise'");
  const schema = (JOB_PAYLOADS as Partial<Record<JobKind, { parse(v: unknown): unknown }>>)[input.kind];
  let payload: JobPayloadInput;
  if (schema) {
    payload = schema.parse(input.payload) as JobPayloadInput;
  } else {
    if (typeof input.payload !== "object" || input.payload === null || !Number.isInteger(input.payload.v) || input.payload.v < 1) {
      throw new Error("jobs: payload must be an object with an integer v >= 1");
    }
    payload = input.payload;
  }
  const maxAttempts =
    input.maxAttempts ?? (JOB_MAX_ATTEMPTS as Partial<Record<JobKind, number>>)[input.kind] ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 32_767) throw new Error("jobs: maxAttempts out of range");
  return { payload, maxAttempts, fairSeq };
}

const LIVE = Prisma.sql`jobs.status IN ('QUEUED', 'RUNNING')`;
/** Reset of a revived terminal row (or of any requeued row): the old run state goes. */
const RESET_RUN_STATE = (keep: Prisma.Sql) => Prisma.sql`
    "lockedBy"    = CASE WHEN ${keep} THEN jobs."lockedBy"    END,
    "lockedAt"    = CASE WHEN ${keep} THEN jobs."lockedAt"    END,
    "heartbeatAt" = CASE WHEN ${keep} THEN jobs."heartbeatAt" END,
    "lastError"   = CASE WHEN ${keep} THEN jobs."lastError"   END,
    result        = CASE WHEN ${keep} THEN jobs.result        END,
    "startedAt"   = CASE WHEN ${keep} THEN jobs."startedAt"   END,
    "finishedAt"  = CASE WHEN ${keep} THEN jobs."finishedAt"  END`;

function conflictClause(policy: ConflictPolicy, reviveDone: boolean): Prisma.Sql {
  if (policy === "keep") return Prisma.sql`ON CONFLICT ("dedupeKey") DO NOTHING`;
  if (policy === "raise") {
    const where = reviveDone ? Prisma.sql`${LIVE} OR jobs.status = 'DONE'` : LIVE;
    return Prisma.sql`ON CONFLICT ("dedupeKey") DO UPDATE SET
    priority      = CASE WHEN ${LIVE} THEN GREATEST(jobs.priority, EXCLUDED.priority) ELSE EXCLUDED.priority END,
    "fairSeq"     = CASE WHEN ${LIVE} THEN LEAST(jobs."fairSeq", EXCLUDED."fairSeq") ELSE EXCLUDED."fairSeq" END,
    "runAt"       = CASE WHEN jobs.status = 'QUEUED' AND jobs.attempts = 0 THEN LEAST(jobs."runAt", EXCLUDED."runAt")
                         WHEN ${LIVE} THEN jobs."runAt" ELSE EXCLUDED."runAt" END,
    status        = CASE WHEN ${LIVE} THEN jobs.status ELSE 'QUEUED'::"JobStatus" END,
    payload       = CASE WHEN ${LIVE} THEN jobs.payload ELSE EXCLUDED.payload END,
    attempts      = CASE WHEN ${LIVE} THEN jobs.attempts ELSE 0 END,
    "maxAttempts" = CASE WHEN ${LIVE} THEN jobs."maxAttempts" ELSE EXCLUDED."maxAttempts" END,
    ${RESET_RUN_STATE(LIVE)}
  WHERE ${where}`;
  }
  const queued = Prisma.sql`jobs.status = 'QUEUED'`;
  return Prisma.sql`ON CONFLICT ("dedupeKey") DO UPDATE SET
    priority      = CASE WHEN ${queued} THEN GREATEST(jobs.priority, EXCLUDED.priority) ELSE EXCLUDED.priority END,
    "fairSeq"     = CASE WHEN ${queued} THEN LEAST(jobs."fairSeq", EXCLUDED."fairSeq") ELSE EXCLUDED."fairSeq" END,
    "runAt"       = EXCLUDED."runAt",
    status        = 'QUEUED'::"JobStatus",
    payload       = EXCLUDED.payload,
    attempts      = 0,
    "maxAttempts" = EXCLUDED."maxAttempts",
    ${RESET_RUN_STATE(Prisma.sql`false`)}
  WHERE jobs.status <> 'RUNNING'`;
}

/**
 * One `INSERT … SELECT … [WHERE when] ON CONFLICT … RETURNING` statement, with no CTE of its own, so it can be the
 * body of a caller's CTE. Returns 0 rows when `when` is false or the conflict policy left an existing row alone.
 * The returned columns: id, status (text), priority, attempts, "runAtMs" (float8), created (boolean).
 */
export function enqueueJobSql(input: EnqueueJobInput): Prisma.Sql {
  const { payload, maxAttempts, fairSeq } = validate(input);
  const policy = input.onConflict ?? "keep";
  return Prisma.sql`INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "userId", "gameId", payload, "runAt", "maxAttempts")
  SELECT ${input.kind}::"JobKind", ${input.priority}::smallint, ${fairSeq}::int, ${input.dedupeKey ?? null}::varchar(120),
         ${input.userId ?? null}::bigint, ${input.gameId ?? null}::bigint, ${JSON.stringify(payload)}::jsonb,
         ${utcTimestamp(input.runAt)}, ${maxAttempts}::smallint
  ${input.when ? Prisma.sql`WHERE ${input.when}` : Prisma.empty}
  ${conflictClause(policy, input.reviveDone === true)}
  RETURNING ${RETURNING}`;
}

/** Runs enqueueJobSql. `null` = nothing inserted or updated (`when` false, or the policy kept the existing row). */
export async function enqueueJob(db: SqlClient, input: EnqueueJobInput): Promise<EnqueuedJob | null> {
  const rows = await db.$queryRaw<JobRow[]>(enqueueJobSql(input));
  return rows[0] ? toJob(rows[0]) : null;
}

// ── ANALYZE_GAME ────────────────────────────────────────────────────────────────────────────────────────────────

export interface EnqueueAnalysisInput {
  gameId: bigint;
  /** games."referenceId" (carried in the payload so the worker can emit without a lookup) */
  gameRef: string;
  /** USER_OPENED (A3), GAME_ENDED (bot complete), BACKLOG (backfill), HOUSEKEEPING (regrade sweep) */
  priority: JobPriority;
  reason: AnalyzeReason;
  /** Per-user ordinal inside a backfill batch; default 0. */
  fairSeq?: number;
}

export type EnqueueAnalysisResult =
  /**
   * `created`: a new job. `updated`: an existing live job got the higher priority, or a DONE job was revived for a
   * regrade. `statusChanged`: games."analysisStatus" moved to QUEUED (NONE → QUEUED, or DONE → QUEUED on a regrade)
   * and the members' gamesVersion was bumped in the same statement.
   */
  | { outcome: "created" | "updated"; job: EnqueuedJob; statusChanged: boolean }
  /**
   * The existing job was left alone: DONE (not a regrade: nothing to do), FAILED (terminal: A3 answers 410) or
   * CANCELLED. `job` is that row as it was.
   */
  | { outcome: "unchanged"; job: EnqueuedJob }
  /** No job: the game does not exist, is not COMPLETED, has fewer than ANALYSIS_MIN_PLIES plies, or is SKIPPED. */
  | { outcome: "ineligible" };

/**
 * ANALYZE_GAME enqueue (plan 7.6) as ONE statement:
 *   1. the job upsert on `analyze:<gameId>` with the `raise` policy (a regrade also revives a DONE job), guarded so
 *      only a COMPLETED, non-SKIPPED game with ≥ ANALYSIS_MIN_PLIES plies gets a job;
 *   2. games."analysisStatus" → QUEUED when it was NONE, or DONE with the job back in QUEUED (regrade);
 *   3. users."gamesVersion" + 1 for the game's members, only when step 2 changed the status (the archive ETag);
 *   4. the result row, or the existing job row when the policy left it alone (a terminal FAILED job is never
 *      resurrected here: A4 is the only path that pulls a backed-off or failed job forward).
 */
export function enqueueAnalysisSql(input: EnqueueAnalysisInput): Prisma.Sql {
  const payload = AnalyzeGamePayloadV1.parse({ v: 1, gameId: input.gameId.toString(), gameRef: input.gameRef, reason: input.reason });
  const dedupeKey = analyzeDedupeKey(input.gameId);
  const job = enqueueJobSql({
    kind: "ANALYZE_GAME",
    priority: input.priority,
    payload,
    dedupeKey,
    gameId: input.gameId,
    fairSeq: input.fairSeq ?? 0,
    onConflict: "raise",
    reviveDone: input.reason === "regrade",
    when: Prisma.sql`EXISTS (SELECT 1 FROM games eg
                              WHERE eg.id = ${input.gameId} AND eg.status = 'COMPLETED'
                                AND eg."plyCount" >= ${ANALYSIS_MIN_PLIES} AND eg."analysisStatus" <> 'SKIPPED')`,
  });
  return Prisma.sql`WITH j AS (
  ${job}
), g AS (
  UPDATE games SET "analysisStatus" = 'QUEUED'
    FROM j
   WHERE games.id = ${input.gameId}
     AND (games."analysisStatus" = 'NONE' OR (games."analysisStatus" = 'DONE' AND j.status = 'QUEUED'))
  RETURNING games.id
), uv AS (
  UPDATE users u SET "gamesVersion" = u."gamesVersion" + 1
    FROM game_players gp JOIN g ON g.id = gp."gameId"
   WHERE u.id = gp."userId"
  RETURNING u.id
)
SELECT j.id, j.status, j.priority, j.attempts, j."runAtMs", j.created,
       (SELECT count(*) FROM g)::int AS changed, (SELECT count(*) FROM uv)::int AS bumped, false AS kept
  FROM j
UNION ALL
SELECT x.id, x.status::text, x.priority, x.attempts, (extract(epoch FROM x."runAt") * 1000)::float8, false, 0, 0, true
  FROM jobs x
 WHERE x."dedupeKey" = ${dedupeKey} AND NOT EXISTS (SELECT 1 FROM j)`;
}

interface AnalysisRow extends JobRow {
  changed: number | string;
  bumped: number | string;
  kept: boolean;
}

export async function enqueueAnalysis(db: SqlClient, input: EnqueueAnalysisInput): Promise<EnqueueAnalysisResult> {
  const rows = await db.$queryRaw<AnalysisRow[]>(enqueueAnalysisSql(input));
  const row = rows[0];
  if (!row) return { outcome: "ineligible" };
  const job = toJob(row);
  if (row.kept) return { outcome: "unchanged", job };
  return { outcome: job.created ? "created" : "updated", job, statusChanged: Number(row.changed) > 0 };
}
