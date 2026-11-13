// Import job helpers of the web (phase-04 plan §7.3.2, §7.3.6, §7.4, §8.5.4; D4-27, D4-31). Server-only. Every
// statement is one Prisma.Sql builder (unit-tested for its shape, run on Postgres in test/api/accounts.contract.int)
// plus a thin runner that takes any SqlClient (the Prisma client through rawDb(), an interactive-transaction client,
// a script's own PrismaClient):
//
//   enqueueImportSql / enqueueImport      the one reusable IMPORT_SYNC row per account (`import:<linkedAccountId>`),
//                                         policy `requeue`: any non-RUNNING row is reset to QUEUED with the new
//                                         payload, runAt and attempts 0; a RUNNING row is left alone → null (the
//                                         caller answers 409 sync_running and rolls back).
//   releaseWaitingImportsSql / …          §8.5.4 step 2, ONE statement: WAITING_FOR_MEMBERSHIP runs → QUEUED, their
//                                         accounts → QUEUED, their jobs at IMPORT_SYNC_INITIAL; and, for a
//                                         returning member, a DAILY sync now for every auto-import account not
//                                         synced in 12 h. Idempotent (a second call releases nothing). WP-D's
//                                         entitlement fan-out calls it, then kickImports("import").
//   kickImports(reason)                   kickWorker({reason, kinds: [IMPORT_SYNC, IMPORT_PURGE]}); never throws.
//   healImportKickSql / healImportKick    ACC-7's registered GET side effect `kick_cas`: P3's compare-and-set on
//                                         jobs."lastKickAt" for `import:<id>` (at most one kick per job per 30 s).
//
// Priorities are JOB_PRIORITY names only (no literals). Timestamps are UTC `timestamp(3)` (Prisma's default).
import {
  IMPORT_TRIGGERS_DB,
  ImportSyncPayloadV1,
  JOB_MAX_ATTEMPTS,
  JOB_PRIORITY,
  importDedupeKey,
  type ImportTriggerDb,
  type JobPriority,
} from "@repo/contracts/internal/jobs";
import { KICK_CAS_WINDOW_MS } from "@repo/contracts/internal/kick";
import { Prisma } from "@repo/db";
import { enqueueJob, enqueueJobSql, type EnqueueJobInput, type EnqueuedJob } from "@repo/db/jobs";
import { kickWorker, type KickResult } from "@/lib/services/analysis/kick";

/** The raw-statement surface every runner here needs (`rawDb(prisma)`, a transaction client, a script's client). */
export interface SqlClient {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
  $executeRaw(query: Prisma.Sql): PromiseLike<number>;
}

/** The kinds an import kick names (the worker's I/O lane). */
export const IMPORT_KICK_KINDS = ["IMPORT_SYNC", "IMPORT_PURGE"] as const;
/** A returning member's auto-import accounts get a DAILY sync at entitlement when their last good sync is older. */
export const RETURNING_SYNC_AFTER_MS = 12 * 3_600_000;

export type EnqueueImportInput = {
  linkedAccountId: bigint;
  userId: bigint;
  /** The run row this job serves; null for a DAILY sync (the worker creates the run only when it finds games). */
  runId: bigint | null;
  trigger: ImportTriggerDb;
  /** JOB_PRIORITY.IMPORT_SYNC_MANUAL | IMPORT_SYNC_INITIAL | IMPORT_SYNC_DAILY. */
  priority: JobPriority;
  /** Earliest start (default: now). */
  runAt?: Date | null;
};

function payloadOf(input: Pick<EnqueueImportInput, "linkedAccountId" | "runId" | "trigger">): ImportSyncPayloadV1 {
  return ImportSyncPayloadV1.parse({
    v: 1,
    linkedAccountId: input.linkedAccountId.toString(),
    runId: input.runId === null ? null : input.runId.toString(),
    trigger: input.trigger,
  });
}

function jobInput(input: EnqueueImportInput): EnqueueJobInput {
  if (!(IMPORT_TRIGGERS_DB as readonly string[]).includes(input.trigger)) throw new Error(`import: unknown trigger ${input.trigger}`);
  return {
    kind: "IMPORT_SYNC",
    priority: input.priority,
    dedupeKey: importDedupeKey(input.linkedAccountId),
    userId: input.userId,
    payload: payloadOf(input),
    runAt: input.runAt ?? null,
    maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
    onConflict: "requeue",
  };
}

export function enqueueImportSql(input: EnqueueImportInput): Prisma.Sql {
  return enqueueJobSql(jobInput(input));
}

/** The queued job, or null when the account's job is RUNNING (→ 409 sync_running). */
export function enqueueImport(db: SqlClient, input: EnqueueImportInput): Promise<EnqueuedJob | null> {
  return enqueueJob(db, jobInput(input));
}

function utc(at: Date | undefined): Prisma.Sql {
  if (!at) return Prisma.sql`(now() AT TIME ZONE 'UTC')`;
  if (Number.isNaN(at.getTime())) throw new Error("import: invalid Date");
  return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** The `requeue` conflict policy of @repo/db/jobs, written out for the multi-row INSERT … SELECT below. */
const REQUEUE = Prisma.sql`ON CONFLICT ("dedupeKey") DO UPDATE SET
    priority = CASE WHEN jobs.status = 'QUEUED' THEN GREATEST(jobs.priority, EXCLUDED.priority) ELSE EXCLUDED.priority END,
    "fairSeq" = 0,
    "runAt" = EXCLUDED."runAt",
    status = 'QUEUED'::"JobStatus",
    payload = EXCLUDED.payload,
    attempts = 0,
    "maxAttempts" = EXCLUDED."maxAttempts",
    "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL, "lastError" = NULL, result = NULL,
    "startedAt" = NULL, "finishedAt" = NULL
  WHERE jobs.status <> 'RUNNING'`;

/**
 * §8.5.4 step 2 as one statement. `rel`: the member's waiting runs → QUEUED; `acc`: their accounts → QUEUED; `ret`:
 * a returning member's auto-import accounts (ACTIVE, no active run, last good sync older than 12 h or never) →
 * QUEUED; `j`: one IMPORT_SYNC upsert per released run (INITIAL priority, the run's own trigger) and per returning
 * account (DAILY, no run row). Re-sending it after a lost response releases nothing new (the runs are no longer
 * waiting; a returning account's job is QUEUED or RUNNING by then, so `ret` skips it).
 */
export function releaseWaitingImportsSql(userId: bigint, now?: Date): Prisma.Sql {
  const NOW = utc(now);
  const initial = JOB_PRIORITY.IMPORT_SYNC_INITIAL;
  const daily = JOB_PRIORITY.IMPORT_SYNC_DAILY;
  const attempts = JOB_MAX_ATTEMPTS.IMPORT_SYNC;
  return Prisma.sql`WITH rel AS (
  UPDATE import_runs SET status = 'QUEUED', "updatedAt" = ${NOW}
   WHERE "userId" = ${userId}::bigint AND status = 'WAITING_FOR_MEMBERSHIP'
  RETURNING id, "linkedAccountId", trigger
), ret AS (
  SELECT la.id AS "linkedAccountId"
    FROM linked_accounts la
   WHERE la."userId" = ${userId}::bigint AND la."autoImport" AND la.status = 'ACTIVE'
     AND (la."lastSyncOkAt" IS NULL OR la."lastSyncOkAt" < ${NOW} - make_interval(secs => ${RETURNING_SYNC_AFTER_MS / 1000}::float8))
     AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r."linkedAccountId" = la.id
                       AND r.status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING'))
     AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'import:' || la.id::text AND j.status IN ('QUEUED', 'RUNNING')
                       AND j."runAt" <= ${NOW})
     AND la.id NOT IN (SELECT "linkedAccountId" FROM rel)
), acc AS (
  UPDATE linked_accounts SET "importState" = 'QUEUED', "updatedAt" = ${NOW}
   WHERE "userId" = ${userId}::bigint
     AND id IN (SELECT "linkedAccountId" FROM rel UNION ALL SELECT "linkedAccountId" FROM ret)
  RETURNING id
), todo AS (
  SELECT rel."linkedAccountId", ${initial}::smallint AS priority,
         jsonb_build_object('v', 1, 'linkedAccountId', rel."linkedAccountId"::text, 'runId', rel.id::text, 'trigger', rel.trigger::text) AS payload
    FROM rel
  UNION ALL
  SELECT ret."linkedAccountId", ${daily}::smallint,
         jsonb_build_object('v', 1, 'linkedAccountId', ret."linkedAccountId"::text, 'runId', NULL, 'trigger', 'DAILY')
    FROM ret
), j AS (
  INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "userId", payload, "runAt", "maxAttempts")
  SELECT 'IMPORT_SYNC'::"JobKind", todo.priority, 0, 'import:' || todo."linkedAccountId"::text, ${userId}::bigint,
         todo.payload, ${NOW}, ${attempts}::smallint
    FROM todo
  ${REQUEUE}
  RETURNING id
)
SELECT (SELECT count(*) FROM rel)::int AS released, (SELECT count(*) FROM j)::int AS queued, (SELECT count(*) FROM acc)::int AS accounts`;
}

export async function releaseWaitingImports(
  db: SqlClient,
  userId: bigint,
  opts: { now?: Date } = {},
): Promise<{ released: number; queued: number }> {
  const rows = await db.$queryRaw<{ released: number | bigint; queued: number | bigint }[]>(releaseWaitingImportsSql(userId, opts.now));
  const row = rows[0];
  return { released: Number(row?.released ?? 0), queued: Number(row?.queued ?? 0) };
}

/**
 * Wakes the worker's I/O lane. Never throws (a lost kick is healed by ACC-7's CAS and the worker's next-due sleep).
 * `runAt` (the enqueued job's due time, default now, ms precision) is always sent: two kicks with the same body in one
 * second carry the same HMAC signature, and the worker refuses the second as a replay — an unlink's purge kick right
 * after a link's import kick was lost that way and the purge waited for the lane's next due job (INTEGRATE-2).
 */
export function kickImports(reason: "import" | "import_retry", opts: { runAt?: Date; nowMs?: number } = {}): Promise<KickResult> {
  const runAt = opts.runAt ?? new Date(opts.nowMs ?? Date.now());
  return kickWorker({ v: 1, reason, kinds: [...IMPORT_KICK_KINDS], runAt: runAt.toISOString() });
}

const NOW_UTC = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const WINDOW = Prisma.sql`make_interval(secs => ${KICK_CAS_WINDOW_MS / 1000})`;

/** P3's kick CAS (heal-kick.ts) for an import job: due for > 30 s and not kicked within 30 s → `lastKickAt = now`. */
export function healImportKickSql(dedupeKey: string): Prisma.Sql {
  if (!/^import:[1-9][0-9]{0,18}$/.test(dedupeKey)) throw new Error("import: not an import dedupe key");
  return Prisma.sql`UPDATE jobs SET "lastKickAt" = ${NOW_UTC}
 WHERE "dedupeKey" = ${dedupeKey} AND status = 'QUEUED'
   AND "runAt" < ${NOW_UTC} - ${WINDOW}
   AND ("lastKickAt" IS NULL OR "lastKickAt" < ${NOW_UTC} - ${WINDOW})
RETURNING id`;
}

/** Runs the CAS and kicks only when this call won it. Returns whether it kicked. */
export async function healImportKick(db: SqlClient, linkedAccountId: bigint): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: bigint }[]>(healImportKickSql(importDedupeKey(linkedAccountId)));
  if (rows.length === 0) return false;
  await kickImports("import");
  return true;
}
