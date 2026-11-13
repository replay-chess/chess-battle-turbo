// The daily-sync backstop (phase-04 plan §7.7.2, §6.3 `linked_accounts_autosync_idx`, §8.10; D4-27). Every linked
// account with auto-import on has ONE `import:<id>` job row that IMPORT_SYNC reschedules after each sync to the
// account's next HH:05 slot. A row can still go missing or stop: a DAILY sync that failed all its attempts (the row
// ends FAILED, `nextAutoSyncAt` stays in the past), a row pruned after 14/30 days, a web enqueue lost to an outage.
// This sweep re-enqueues those accounts' DAILY wake, due at once:
//
//   autoImport AND status ACTIVE AND nextAutoSyncAt < now − 1 h (the partial index), not parked for a membership
//   (WAITING_FOR_MEMBERSHIP: the entitlement fan-out restarts those), with no live job (QUEUED/RUNNING) and no active
//   run (a QUEUED/RUNNING run belongs to its own job), oldest first, at most IMPORT_BACKSTOP_LIMIT per sweep.
//
// It runs where the worker is awake anyway, never on a timer of its own: inside the daily HOUSEKEEPING batch (a
// `statements()` slice) and in the boot batch (boot.ts appends `importBackstopStatement()`). One set-based statement,
// idempotent: the upsert touches only rows that are not live, so a resend after a lost response finds nothing to do.
//
// FIX-1: a second statement, `releaseParkedImportsStatement`, releases the WAITING_FOR_MEMBERSHIP runs of users who are
// members now (the entitlement fan-out's backstop), in the same two places.
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { RecurringSlice } from "./types";

/** Accounts re-enqueued per sweep (§6.3). The rest go at the next sweep. */
export const IMPORT_BACKSTOP_LIMIT = 200;
/** An account counts as lost this long after its `nextAutoSyncAt` (§6.3: one hour of grace for a slow queue). */
export const IMPORT_BACKSTOP_GRACE_SEC = 3_600;

export function importBackstopStatement(limit = IMPORT_BACKSTOP_LIMIT): Statement {
  return stmt(
    `WITH lost AS (
  SELECT la.id, la."userId" FROM linked_accounts la
   WHERE la."autoImport" AND la.status = 'ACTIVE'
     AND la."nextAutoSyncAt" < ${NOW} - ($1::int * interval '1 second')
     AND la."importState" <> 'WAITING_FOR_MEMBERSHIP'
     AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."dedupeKey" = 'import:' || la.id::text AND j.status IN ('QUEUED', 'RUNNING'))
     AND NOT EXISTS (SELECT 1 FROM import_runs r WHERE r."linkedAccountId" = la.id AND r.status IN ('QUEUED', 'RUNNING'))
   ORDER BY la."nextAutoSyncAt"
   LIMIT $2
), up AS (
  INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "userId", payload, "runAt", "maxAttempts")
  SELECT 'IMPORT_SYNC'::"JobKind", $3::smallint, 0, 'import:' || l.id::text, l."userId",
         jsonb_build_object('v', 1, 'linkedAccountId', l.id::text, 'runId', NULL, 'trigger', 'DAILY'),
         ${NOW}, $4::smallint
    FROM lost l
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    kind = EXCLUDED.kind, priority = EXCLUDED.priority, "fairSeq" = 0, payload = EXCLUDED.payload,
    "runAt" = EXCLUDED."runAt", status = 'QUEUED'::"JobStatus", attempts = 0, "maxAttempts" = EXCLUDED."maxAttempts",
    "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL, "lastError" = NULL, result = NULL,
    "startedAt" = NULL, "finishedAt" = NULL
  WHERE jobs.status IN ('DONE', 'FAILED', 'CANCELLED')
  RETURNING 1
)
SELECT count(*)::int AS requeued FROM up`,
    [IMPORT_BACKSTOP_GRACE_SEC, limit, JOB_PRIORITY.IMPORT_SYNC_DAILY, JOB_MAX_ATTEMPTS.IMPORT_SYNC],
  );
}

/** Parked runs released per sweep (FIX-1). The rest go at the next sweep. */
export const IMPORT_RELEASE_LIMIT = 200;

/**
 * The entitlement fan-out's backstop (FIX-1). A run parked WAITING_FOR_MEMBERSHIP is released by the web's
 * `releaseWaitingImports` from the payment's after() fan-out, which is best effort: a lost after(), a replayed or later
 * webhook that is unchanged (no fan-out), or a link that read the viewer as not entitled and parked its run after the
 * fan-out had already run, left a paying member's import waiting until the 30-day cancel. This sweep releases every
 * parked run whose user is a member now, with the web's rules (context.ts isMember: an admin, or entitled; `paywall`
 * false = everyone): run → QUEUED, its account → QUEUED, its `import:<id>` job upserted at IMPORT_SYNC_INITIAL and due
 * now (the web's REQUEUE: never over a RUNNING row), oldest first, at most `limit`.
 *
 * One statement, idempotent: it touches only WAITING runs, so a resend after a lost response finds nothing to do.
 */
export function releaseParkedImportsStatement(paywall: boolean, limit = IMPORT_RELEASE_LIMIT): Statement {
  return stmt(
    `WITH cand AS (
  SELECT r.id FROM import_runs r JOIN users u ON u.id = r."userId"
   WHERE r.status = 'WAITING_FOR_MEMBERSHIP'
     AND (NOT $2::boolean OR u.role = 'ADMIN' OR u."subscriptionStatus" = 'active'
          OR (u."subscriptionStatus" = 'cancelled' AND u."cancelAtPeriodEnd" AND u."currentPeriodEnd" > ${NOW})
          OR (u."subscriptionStatus" IN ('on_hold', 'past_due') AND u."currentPeriodEnd" > ${NOW}))
   ORDER BY r."createdAt", r.id
   LIMIT $1
), rel AS (
  UPDATE import_runs r SET status = 'QUEUED', "updatedAt" = ${NOW}
    FROM cand WHERE r.id = cand.id AND r.status = 'WAITING_FOR_MEMBERSHIP'
  RETURNING r.id, r."linkedAccountId", r."userId", r.trigger
), acc AS (
  UPDATE linked_accounts la SET "importState" = 'QUEUED', "updatedAt" = ${NOW}
    FROM rel WHERE la.id = rel."linkedAccountId"
  RETURNING la.id
), up AS (
  INSERT INTO jobs (kind, priority, "fairSeq", "dedupeKey", "userId", payload, "runAt", "maxAttempts")
  SELECT 'IMPORT_SYNC'::"JobKind", $3::smallint, 0, 'import:' || rel."linkedAccountId"::text, rel."userId",
         jsonb_build_object('v', 1, 'linkedAccountId', rel."linkedAccountId"::text, 'runId', rel.id::text, 'trigger', rel.trigger::text),
         ${NOW}, $4::smallint
    FROM rel
  ON CONFLICT ("dedupeKey") DO UPDATE SET
    priority = CASE WHEN jobs.status = 'QUEUED' THEN GREATEST(jobs.priority, EXCLUDED.priority) ELSE EXCLUDED.priority END,
    "fairSeq" = 0, "runAt" = EXCLUDED."runAt", status = 'QUEUED'::"JobStatus", payload = EXCLUDED.payload, attempts = 0,
    "maxAttempts" = EXCLUDED."maxAttempts", "lockedBy" = NULL, "lockedAt" = NULL, "heartbeatAt" = NULL, "lastError" = NULL,
    result = NULL, "startedAt" = NULL, "finishedAt" = NULL
  WHERE jobs.status <> 'RUNNING'
  RETURNING 1
)
SELECT (SELECT count(*) FROM rel)::int AS released, (SELECT count(*) FROM acc)::int AS accounts, (SELECT count(*) FROM up)::int AS queued`,
    [limit, paywall, JOB_PRIORITY.IMPORT_SYNC_INITIAL, JOB_MAX_ATTEMPTS.IMPORT_SYNC],
  );
}

export const importBackstop: RecurringSlice = {
  id: "import-backstop",
  // HOUSEKEEPING releases with the paywall on (only entitled members); with BILLING_PAYWALL=off nothing parks, and
  // the boot sweep passes the worker's own setting (boot.ts).
  statements: () => [importBackstopStatement(), releaseParkedImportsStatement(true)],
  async after(ctx, [rows, released]) {
    const requeued = num(rows?.[0]?.requeued ?? 0);
    if (requeued > 0) ctx.log.warn("import backstop re-enqueued lost daily syncs", { requeued });
    else ctx.log.info("import backstop: no lost daily sync");
    const freed = num(released?.[0]?.released ?? 0);
    if (freed > 0) ctx.log.warn("import backstop released parked imports of members", { released: freed });
  },
};
