// Shared SQL pieces of the import statements (phase-04 plan §8.8, §9.4).
//
// `heldCte`: the job lock check INSIDE a single data-modifying statement. P3 guards a batch with a separate
// lockGuardStatement; an import chunk is one statement per 100 games (§9.4 counts statements), so the guard rides in
// it instead: the CTE heart-beats the job row (an UPDATE, so it also row-locks it like FOR UPDATE) and the statement's
// final SELECT divides by the number of rows it touched. When this worker no longer holds the job (reaped and taken
// by another worker), that raises `division_by_zero` (SQLSTATE 22012, `isLockLost`) and the whole statement rolls
// back: a worker that lost its job can never write another chunk, so two workers never import one account twice.
// The heartbeat it writes means a long saving phase never looks stalled to the reaper either.
import { NOW } from "../queue/claim";

export { NOW };

/** `held AS (…)`: heart-beats the job when `$jobParam` is RUNNING under `$meParam`; `HELD_CHECK` raises otherwise. */
export function heldCte(jobParam: string, meParam: string): string {
  return `held AS (
  UPDATE jobs SET "heartbeatAt" = ${NOW}
   WHERE id = ${jobParam}::bigint AND "lockedBy" = ${meParam} AND status = 'RUNNING'
  RETURNING priority
)`;
}

/** A select-list item that raises 22012 when `held` touched no row (selected by the statement's final SELECT). */
export const HELD_CHECK = `(SELECT 1 / (SELECT count(*)::int FROM held)) AS held`;

/** `(extract(epoch FROM col) * 1000)::float8`. */
export const epochMs = (col: string) => `(extract(epoch FROM ${col}) * 1000)::float8`;

/** A JS instant as a UTC `timestamp` parameter: `($n::timestamptz AT TIME ZONE 'UTC')`. */
export const utcParam = (param: string) => `(${param}::timestamptz AT TIME ZONE 'UTC')`;
