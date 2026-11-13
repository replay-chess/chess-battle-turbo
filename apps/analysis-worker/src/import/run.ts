// The run-row statements of an IMPORT_SYNC attempt (phase-04 plan §7.7.2 "startRun, parkRun, setTotal, finishRun,
// failRun (one statement each)", §8.10, §8.11, §9.4). Each is ONE statement; the ones that end an attempt run in the
// handler's final batch behind P3's lockGuardStatement, so they commit together with the job's own outcome
// (reschedule / done / back-off) or not at all. `setTotal` has no statement of its own: the total rides in the first
// saving chunk (batch-writer.ts) or in the finish.
//
// Re-sending after a lost response (P3-D11): start, daily-run creation and the reading progress are idempotent on
// their own (a state that is already reached matches again; the daily run's reference id is fixed by the worker, so
// a resend finds the row it created). The batch statements are covered by the guard + `outcomeByMeStatement` check.
import { stmt, type Statement } from "../db/client";
import type { ImportErrorV1 } from "@repo/db/json";
import type { ProviderDb } from "./context";
import { epochMs, NOW, utcParam } from "./sql";

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** QUEUED / WAITING / RUNNING → RUNNING (reading); the account RUNNING; the cursor row created if missing. */
export function startRunStatement(input: { runId: string; linkedAccountId: string; provider: ProviderDb }): Statement {
  return stmt(
    `WITH r AS (
  UPDATE import_runs SET status = 'RUNNING', phase = 'reading', "startedAt" = COALESCE("startedAt", ${NOW}),
         "finishedAt" = NULL, "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING')
  RETURNING id
), a AS (
  UPDATE linked_accounts SET "importState" = 'RUNNING', "lastSyncAt" = ${NOW}, "updatedAt" = ${NOW}
   WHERE id = $2::bigint AND EXISTS (SELECT 1 FROM r)
  RETURNING id
), c AS (
  INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt")
  SELECT $2::bigint, $3::"ChessProvider", ${NOW} WHERE EXISTS (SELECT 1 FROM r)
  ON CONFLICT ("linkedAccountId") DO NOTHING
  RETURNING 1
)
SELECT (SELECT count(*) FROM r)::int AS started`,
    [input.runId, input.linkedAccountId, input.provider],
  );
}

/**
 * A DAILY sync found new games: its run is created now (a DAILY run with 0 new games is never inserted, §6.8, §9.4),
 * RUNNING, with the worker-made reference id. A resend after a lost response finds the row it created by that id.
 * No row back = another run of the account is active (import_runs_one_active).
 */
export function createDailyRunStatement(input: {
  ref: string;
  userId: string;
  linkedAccountId: string;
  provider: ProviderDb;
}): Statement {
  return stmt(
    `WITH ins AS (
  INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, phase, "startedAt",
                           "createdAt", "updatedAt")
  VALUES ($1, $2::bigint, $3::bigint, $4::"ChessProvider", 'DAILY', 'RUNNING', 'reading', ${NOW}, ${NOW}, ${NOW})
  ON CONFLICT DO NOTHING
  RETURNING id, "referenceId"
), got AS (
  SELECT id, "referenceId" FROM ins
  UNION ALL
  SELECT id, "referenceId" FROM import_runs WHERE "referenceId" = $1 AND NOT EXISTS (SELECT 1 FROM ins)
), a AS (
  UPDATE linked_accounts SET "importState" = 'RUNNING', "lastSyncAt" = ${NOW}, "updatedAt" = ${NOW}
   WHERE id = $3::bigint AND EXISTS (SELECT 1 FROM got)
  RETURNING id
), c AS (
  INSERT INTO import_cursors ("linkedAccountId", provider, "updatedAt")
  SELECT $3::bigint, $4::"ChessProvider", ${NOW} WHERE EXISTS (SELECT 1 FROM got)
  ON CONFLICT ("linkedAccountId") DO NOTHING
  RETURNING 1
)
SELECT id::text AS id, "referenceId" AS ref FROM got`,
    [input.ref, input.userId, input.linkedAccountId, input.provider],
  );
}

/** The reading phase's progress write (≤ 1 per 5 s, §9.4). */
export function readingProgressStatement(runId: string, seen: number): Statement {
  return stmt(
    `UPDATE import_runs SET seen = GREATEST(seen, $2::int), phase = 'reading', "updatedAt" = ${NOW}
      WHERE id = $1::bigint AND status = 'RUNNING'`,
    [runId, seen],
  );
}

/**
 * Not a member at the start (§8.11 row "Not entitled at start"; §8.10 "Lapsed members"): the run waits for the
 * entitlement fan-out (WEB releaseWaitingImports), the account shows `waiting_for_membership`. A DAILY wake without a
 * run parks a new WAITING DAILY run, so the fan-out restarts the account's syncs when the member returns. No
 * reschedule: the job ends DONE in the same batch.
 */
export function parkRunStatement(input: {
  runId: string | null;
  dailyRef: string;
  userId: string;
  linkedAccountId: string;
  provider: ProviderDb;
}): Statement {
  return stmt(
    `WITH r AS (
  UPDATE import_runs SET status = 'WAITING_FOR_MEMBERSHIP', phase = NULL, "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND status IN ('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING')
  RETURNING id
), ins AS (
  INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "createdAt", "updatedAt")
  SELECT $2, $3::bigint, $4::bigint, $5::"ChessProvider", 'DAILY', 'WAITING_FOR_MEMBERSHIP', ${NOW}, ${NOW}
   WHERE $1::bigint IS NULL
  ON CONFLICT DO NOTHING
  RETURNING id
), a AS (
  UPDATE linked_accounts SET "importState" = 'WAITING_FOR_MEMBERSHIP', "nextAutoSyncAt" = NULL, "updatedAt" = ${NOW}
   WHERE id = $4::bigint
  RETURNING id
)
SELECT (SELECT count(*) FROM r)::int + (SELECT count(*) FROM ins)::int AS parked`,
    [input.runId, input.dailyRef, input.userId, input.linkedAccountId, input.provider],
  );
}

export interface FinishInput {
  runId: string | null;
  linkedAccountId: string;
  provider: ProviderDb;
  /** The attempt's finish time (also linked_accounts."lastSyncAt" / "lastSyncOkAt"). */
  atMs: number;
  /** The next automatic sync (null: auto-import off). */
  nextAutoSyncAtMs: number | null;
  /** Games in the window after the filters (the run's total). */
  total: number;
  seen: number;
  /** The run's skipped games: absolute (Chess.com re-reads every month of an attempt) or added (Lichess). */
  runSkipped: { abs: number } | { add: number };
  /** The account's lifetime skipped games: absolute (sum over the archive months) or added. */
  accountSkipped: { abs: number } | { add: number };
  /** From the Chess.com profile: refreshed when given. */
  profile: { title: string | null; avatarUrl: string | null; playerId: string | null } | null;
  cursor: {
    archivesEtag: string | null;
    archivesLastModified: string | null;
    /** The whole merged ArchivesV1 (null = keep). */
    archives: unknown | null;
    /** Lichess: the newest creation time this attempt read (the run's newest saved game is added in SQL). */
    lichessNewestMs: number | null;
    oldestImportedAtMs: number | null;
    seenAdd: number;
    skippedVariantsAdd: number;
  };
}

/**
 * The run is DONE (§8.6–8.10): run counters, the account back to IDLE / ACTIVE with the sync stamps and the next
 * automatic sync, the profile refresh, and the cursor (archive validators and months, the Lichess `since` = the
 * newest creation time seen, the resume point cleared). Always one row back (the run columns are NULL for a DAILY
 * sync that found nothing and has no run).
 */
export function finishRunStatement(f: FinishInput): Statement {
  const skippedAbs = (s: FinishInput["runSkipped"]) => ("abs" in s ? s.abs : null);
  const skippedAdd = (s: FinishInput["runSkipped"]) => ("add" in s ? s.add : 0);
  return stmt(
    `WITH r AS (
  UPDATE import_runs SET status = 'DONE', phase = NULL, "finishedAt" = ${NOW}, error = NULL,
         total = GREATEST($5::int, imported), seen = GREATEST(seen, $6::int),
         skipped = COALESCE($7::int, skipped + $8::int), "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND status = 'RUNNING'
  RETURNING id, "referenceId", imported, skipped, total, "analysisQueued", analysed, "firstGameId"
), a AS (
  UPDATE linked_accounts SET status = 'ACTIVE', "importState" = 'IDLE', "lastSyncAt" = ${utcParam("$3")},
         "lastSyncOkAt" = ${utcParam("$3")},
         "nextAutoSyncAt" = ${utcParam("$4")},
         "nextAllowedSyncAt" = NULL, "lastError" = NULL,
         "skippedCount" = COALESCE($9::int, "skippedCount" + $10::int),
         title = CASE WHEN $11::boolean THEN $12 ELSE title END,
         "avatarUrl" = CASE WHEN $11::boolean THEN $13 ELSE "avatarUrl" END,
         "externalId" = CASE WHEN $14::text IS NOT NULL AND "verifiedAt" IS NULL AND "externalId" = "usernameLower"
                             THEN $14 ELSE "externalId" END,
         "updatedAt" = ${NOW}
   WHERE id = $2::bigint
  RETURNING id
), newest AS (
  SELECT (extract(epoch FROM g."createdAt") * 1000)::bigint AS ms FROM r JOIN games g ON g.id = r."firstGameId"
), c AS (
  INSERT INTO import_cursors ("linkedAccountId", provider, "archivesEtag", "archivesLastModified", archives,
                              "lichessSinceMs", "lichessResumeUntilMs", "oldestImportedAt", seen, "skippedVariants",
                              "updatedAt")
  VALUES ($2::bigint, $15::"ChessProvider", $16, $17, $18::jsonb,
          NULLIF(GREATEST(COALESCE($19::bigint, 0), COALESCE((SELECT ms FROM newest), 0)), 0), NULL,
          ${utcParam("$20")}, $21::int, $22::int, ${NOW})
  ON CONFLICT ("linkedAccountId") DO UPDATE SET
         "archivesEtag" = COALESCE(EXCLUDED."archivesEtag", import_cursors."archivesEtag"),
         "archivesLastModified" = COALESCE(EXCLUDED."archivesLastModified", import_cursors."archivesLastModified"),
         archives = COALESCE(EXCLUDED.archives, import_cursors.archives),
         "lichessSinceMs" = NULLIF(GREATEST(COALESCE(import_cursors."lichessSinceMs", 0),
                                            COALESCE(EXCLUDED."lichessSinceMs", 0)), 0),
         "lichessResumeUntilMs" = NULL,
         "oldestImportedAt" = LEAST(import_cursors."oldestImportedAt", EXCLUDED."oldestImportedAt"),
         seen = import_cursors.seen + EXCLUDED.seen,
         "skippedVariants" = import_cursors."skippedVariants" + EXCLUDED."skippedVariants",
         "updatedAt" = ${NOW}
  RETURNING 1
)
SELECT r.id::text AS "runId", r."referenceId" AS "runRef", r.imported, r.skipped, r.total, r."analysisQueued",
       r.analysed, fg."referenceId" AS "firstGameRef", fg."analysisStatus"::text AS "firstGameStatus",
       (SELECT count(*) FROM a)::int AS accounts
  FROM (SELECT 1) one
  LEFT JOIN r ON true
  LEFT JOIN games fg ON fg.id = r."firstGameId"`,
    [
      f.runId,
      f.linkedAccountId,
      new Date(f.atMs).toISOString(),
      iso(f.nextAutoSyncAtMs),
      f.total,
      f.seen,
      skippedAbs(f.runSkipped),
      skippedAdd(f.runSkipped),
      skippedAbs(f.accountSkipped),
      skippedAdd(f.accountSkipped),
      f.profile !== null,
      f.profile?.title ?? null,
      f.profile?.avatarUrl ?? null,
      f.profile?.playerId ?? null,
      f.provider,
      f.cursor.archivesEtag,
      f.cursor.archivesLastModified,
      f.cursor.archives === null ? null : JSON.stringify(f.cursor.archives),
      f.cursor.lichessNewestMs === null ? null : String(Math.trunc(f.cursor.lichessNewestMs)),
      iso(f.cursor.oldestImportedAtMs),
      f.cursor.seenAdd,
      f.cursor.skippedVariantsAdd,
    ],
  );
}

export interface FinishedRun {
  runId: string;
  runRef: string;
  imported: number;
  skipped: number;
  total: number;
  analysisQueued: number;
  analysed: number;
  /** The newest saved game the run queued for analysis (the Done screen's review), else null. */
  firstReviewGameRef: string | null;
}

export function toFinishedRun(row: Record<string, unknown> | undefined): FinishedRun | null {
  if (!row || row.runId === null || row.runId === undefined) return null;
  const status = typeof row.firstGameStatus === "string" ? row.firstGameStatus : null;
  return {
    runId: String(row.runId),
    runRef: String(row.runRef),
    imported: Number(row.imported),
    skipped: Number(row.skipped),
    total: Number(row.total),
    analysisQueued: Number(row.analysisQueued),
    analysed: Number(row.analysed),
    firstReviewGameRef: status && status !== "NONE" && typeof row.firstGameRef === "string" ? row.firstGameRef : null,
  };
}

/** The run's numbers after a finish whose response was lost (the resend found the job already rescheduled). */
export function runSummaryStatement(runId: string): Statement {
  return stmt(
    `SELECT r.id::text AS "runId", r."referenceId" AS "runRef", r.imported, r.skipped, r.total, r."analysisQueued",
            r.analysed, fg."referenceId" AS "firstGameRef", fg."analysisStatus"::text AS "firstGameStatus"
       FROM import_runs r LEFT JOIN games fg ON fg.id = r."firstGameId"
      WHERE r.id = $1::bigint`,
    [runId],
  );
}

export type FailureState =
  /** A 429 (§8.11): the run waits in QUEUED, the account RATE_LIMITED until `retryAt`. */
  | { kind: "rate_limited"; retryAtMs: number }
  /** A 5xx / timeout before the last attempt: the run stays RUNNING (the job's back-off retries it). */
  | { kind: "retrying"; retryAtMs: number }
  /** The last attempt, or a failure no retry can fix (not_found, closed): FAILED; `linkError` sets status ERROR. */
  | { kind: "terminal"; linkError: boolean };

/**
 * The run and account side of a failed attempt (§8.11), written in the same batch as the job's back-off. `error` is
 * the ImportErrorV1 stored on both rows. `skippedAdd`: Lichess games skipped in the part of the stream this attempt
 * saved (the resume reads only what is older, so they are counted now).
 */
export function failRunStatement(input: {
  runId: string | null;
  linkedAccountId: string;
  state: FailureState;
  error: ImportErrorV1;
  skippedAdd: number;
}): Statement {
  const s = input.state;
  const runStatus = s.kind === "rate_limited" ? "QUEUED" : s.kind === "retrying" ? "RUNNING" : "FAILED";
  const importState = s.kind === "rate_limited" ? "RATE_LIMITED" : s.kind === "retrying" ? "RUNNING" : "FAILED";
  const nextAllowed = s.kind === "rate_limited" ? iso(s.retryAtMs) : null;
  return stmt(
    `WITH r AS (
  UPDATE import_runs SET status = $3::"ImportRunStatus", error = $4::jsonb,
         phase = CASE WHEN $3::"ImportRunStatus" = 'RUNNING' THEN phase END,
         "finishedAt" = CASE WHEN $3::"ImportRunStatus" = 'FAILED' THEN ${NOW} END,
         skipped = skipped + $7::int, "updatedAt" = ${NOW}
   WHERE id = $1::bigint AND status IN ('QUEUED', 'RUNNING')
  RETURNING id, "referenceId", imported, total
), a AS (
  UPDATE linked_accounts SET "importState" = $5::"ImportState", "lastError" = $4::jsonb,
         status = CASE WHEN $8::boolean THEN 'ERROR'::"LinkStatus" ELSE status END,
         "nextAllowedSyncAt" = COALESCE(${utcParam("$6")}, "nextAllowedSyncAt"),
         "skippedCount" = "skippedCount" + $7::int, "updatedAt" = ${NOW}
   WHERE id = $2::bigint
  RETURNING id
)
SELECT r."referenceId" AS "runRef", r.imported, r.total FROM (SELECT 1) one LEFT JOIN r ON true`,
    [
      input.runId,
      input.linkedAccountId,
      runStatus,
      JSON.stringify(input.error),
      importState,
      nextAllowed,
      input.skippedAdd,
      s.kind === "terminal" && s.linkError,
    ],
  );
}

/**
 * The job ended FAILED without the handler's own failure write (an unexpected error on the last attempt, or the
 * reaper's last retry): the account's active QUEUED / RUNNING run and the account become FAILED, so the run never
 * shows "syncing" forever. Idempotent (only active rows change).
 */
export function failRunOfJobStatement(jobId: string, error: ImportErrorV1): Statement {
  return stmt(
    `WITH j AS (
  SELECT CASE WHEN payload->>'linkedAccountId' ~ '^[0-9]{1,18}$' THEN (payload->>'linkedAccountId')::bigint END AS la
    FROM jobs WHERE id = $1::bigint AND kind = 'IMPORT_SYNC' AND status = 'FAILED'
), r AS (
  UPDATE import_runs SET status = 'FAILED', error = $2::jsonb, phase = NULL, "finishedAt" = ${NOW}, "updatedAt" = ${NOW}
   WHERE "linkedAccountId" = (SELECT la FROM j) AND status IN ('QUEUED', 'RUNNING')
  RETURNING "referenceId", imported, total, "userId", provider
), a AS (
  UPDATE linked_accounts SET "importState" = 'FAILED', "lastError" = $2::jsonb, "updatedAt" = ${NOW}
   WHERE id = (SELECT la FROM j) AND "importState" IN ('QUEUED', 'RUNNING', 'RATE_LIMITED')
  RETURNING id
)
SELECT r."referenceId" AS "runRef", r.imported, r.total, r.provider::text AS provider, u."referenceId" AS "userRef",
       ${epochMs(NOW)} AS "atMs"
  FROM r JOIN users u ON u.id = r."userId"`,
    [jobId, JSON.stringify(error)],
  );
}
