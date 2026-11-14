// HOUSEKEEPING slice (phase-05 plan §7.6 "HOUSEKEEPING (P3, rules added)", §9.7): the training tables' daily hygiene,
// three set-based statements in HOUSEKEEPING's one batch, each capped so a day's work stays far below the role's
// statement timeout (anything left over goes the next day, as prune-jobs.ts does):
//   - a runner session left ACTIVE for over 24 hours is ABANDONED (its summary is then final);
//   - a frozen daily plan (`training_days.plan`, ≈ 1 KB) is dropped after 7 days (the counters stay: week strip, caps);
//   - sessions older than 90 days are deleted (attempts keep their plain `sessionId`; history outlives sessions).
// Times are the job clock (NOW), never a client's.
import { num, stmt, type Statement } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { RecurringSlice } from "./types";

export const STALE_SESSION_HOURS = 24;
export const PLAN_KEEP_DAYS = 7;
export const SESSION_KEEP_DAYS = 90;
/** Rows per statement per day. */
export const TRAINING_HYGIENE_MAX = 1_000;

export function abandonStaleSessionsStatement(max = TRAINING_HYGIENE_MAX): Statement {
  return stmt(
    `WITH s AS (
  UPDATE training_sessions SET status = 'ABANDONED', "endedAt" = COALESCE("endedAt", ${NOW})
   WHERE id IN (SELECT id FROM training_sessions
                 WHERE status = 'ACTIVE' AND "startedAt" < ${NOW} - ($1::int * interval '1 hour')
                 LIMIT $2)
  RETURNING 1
)
SELECT count(*)::int AS abandoned FROM s`,
    [STALE_SESSION_HOURS, max],
  );
}

export function dropOldPlansStatement(max = TRAINING_HYGIENE_MAX): Statement {
  return stmt(
    `WITH d AS (
  UPDATE training_days SET plan = NULL, "updatedAt" = ${NOW}
   WHERE ctid IN (SELECT ctid FROM training_days
                   WHERE plan IS NOT NULL AND day < (${NOW})::date - $1::int
                   LIMIT $2)
  RETURNING 1
)
SELECT count(*)::int AS cleared FROM d`,
    [PLAN_KEEP_DAYS, max],
  );
}

export function pruneOldSessionsStatement(max = TRAINING_HYGIENE_MAX): Statement {
  return stmt(
    `WITH d AS (
  DELETE FROM training_sessions
   WHERE id IN (SELECT id FROM training_sessions
                 WHERE "startedAt" < ${NOW} - ($1::int * interval '1 day')
                 LIMIT $2)
  RETURNING 1
)
SELECT count(*)::int AS deleted FROM d`,
    [SESSION_KEEP_DAYS, max],
  );
}

export const trainingHygiene: RecurringSlice = {
  id: "training-hygiene",
  statements: () => [abandonStaleSessionsStatement(), dropOldPlansStatement(), pruneOldSessionsStatement()],
  async after(ctx, [abandoned, cleared, deleted]) {
    ctx.log.info("training hygiene", {
      abandoned: num(abandoned?.[0]?.abandoned ?? 0),
      plansCleared: num(cleared?.[0]?.cleared ?? 0),
      sessionsDeleted: num(deleted?.[0]?.deleted ?? 0),
    });
  },
};
