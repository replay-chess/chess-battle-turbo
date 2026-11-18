// The worker's RECOMPUTE_WEAKNESS triggers (phase-06 plan §7.4.1 trigger table), all through the shared upsert of
// @repo/db/weakness-jobs (one row per member, coalesced). With WEAKNESS_JOBS_ENABLED off they build nothing (the kill
// switch: the worker's own triggers no-op; rows the web still arms end DONE `skipped: "disabled"`).
//
// | trigger      | where                                          | priority          | runAt / debounce     |
// |--------------|------------------------------------------------|-------------------|----------------------|
// | analysis     | the final analysis batch (p06-weakness.ts)     | WEAKNESS          | now + 240 s / 240 s  |
// | first_build  | after an analysis commit (progressEmitter.ts)  | GAME_ENDED        | now / 0              |
// | import       | the IMPORT_SYNC finish batch                   | WEAKNESS          | now + 120 s / 240 s  |
// | weekly, heal, algo | the daily slice (scheduler/recurring/weakness.ts) | HOUSEKEEPING | now / 0         |
// | removed      | the IMPORT_PURGE final batch (FIX-1)           | WEAKNESS          | now / 0              |
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueWeaknessManySql, enqueueWeaknessSql, userIdsLiteral, weaknessRemovedSql } from "@repo/db/weakness-jobs";
import { fromPrisma, stmt, type Row, type Statement } from "../db/client";
import type { WeaknessSettings } from "./settings";

/** `import`: the recompute waits this long after the sync finished (its first analyses land meanwhile). */
export const IMPORT_TRIGGER_DELAY_SEC = 120;

/**
 * `analysis` (§7.4.1): for each of `userIds` that has a READY snapshot (checked in SQL, inside the batch), the member's
 * row is armed at the database's now + the debounce. Members without a READY profile are the progress emitter's (`first_build`).
 */
export function analysisTriggerStatement(userIds: readonly string[], s: WeaknessSettings): Statement | null {
  if (!s.enabled || userIds.length === 0) return null;
  return fromPrisma(
    enqueueWeaknessManySql({
      rows: `SELECT x.u, 'analysis'::text FROM unnest(${userIdsLiteral(userIds)}) AS x(u)
              WHERE EXISTS (SELECT 1 FROM weakness_snapshots ws WHERE ws."userId" = x.u AND ws.status = 'READY')`,
      priority: JOB_PRIORITY.WEAKNESS,
      runAt: null,
      delaySec: s.debounceSec,
      debounceSec: s.debounceSec,
      freezeSeeded: s.seedFreeze,
    }),
  );
}

/** `first_build`: the in-scope analysed count reached 5, 10, 15, 20 or more and the member has no READY profile. */
export function firstBuildStatement(userId: string, nowMs: number, s: WeaknessSettings): Statement | null {
  if (!s.enabled) return null;
  return fromPrisma(
    enqueueWeaknessSql({
      userId: BigInt(userId),
      trigger: "first_build",
      priority: JOB_PRIORITY.GAME_ENDED,
      runAt: new Date(nowMs),
      debounceSec: 0,
      freezeSeeded: s.seedFreeze,
    }),
  );
}

/** `import`: an IMPORT_SYNC that added games finished (a statement of its finish batch). */
export function importTriggerStatement(userId: string, nowMs: number, s: WeaknessSettings): Statement | null {
  if (!s.enabled) return null;
  return fromPrisma(
    enqueueWeaknessSql({
      userId: BigInt(userId),
      trigger: "import",
      priority: JOB_PRIORITY.WEAKNESS,
      runAt: new Date(nowMs + IMPORT_TRIGGER_DELAY_SEC * 1000),
      debounceSec: s.debounceSec,
      freezeSeeded: s.seedFreeze,
    }),
  );
}

/**
 * `removed` (FIX-1; FIX-3: also when a recompute is QUEUED or RUNNING, D-P6-FIX3-1): a purge deleted games of a member
 * who has a snapshot. Without it a READY profile kept counting
 * the purged games and pointing at their deleted mistakes until the weekly roll, which a member with no games left
 * never gets. A statement of the purge's final batch (only when it removed rows).
 */
export function removedTriggerStatement(userId: string, s: WeaknessSettings): Statement | null {
  if (!s.enabled) return null;
  return fromPrisma(weaknessRemovedSql(userId, { freezeSeeded: s.seedFreeze }));
}

/**
 * FIX-2 (D-P6-FIX2-13): a purge removes every weakness snapshot of the member, every week, after the `removed` arm
 * (which reads "has a snapshot" first, in the same batch). Older weeks were computed from the purged games: their
 * example positions (FEN + mistakeRef) and counts would outlive the games for 12 weeks. The recompute the arm queued
 * writes the current week from what is left. Runs whether or not the weakness jobs are enabled: deleting the member's
 * data does not wait for the kill switch.
 */
export function purgedSnapshotsStatement(userId: string): Statement {
  return stmt(`WITH d AS (DELETE FROM weakness_snapshots WHERE "userId" = $1::bigint RETURNING 1) SELECT count(*)::int AS deleted FROM d`, [userId]);
}

/** How many rows of an enqueue's RETURNING met an existing row (`created` false): `worker.weakness.coalesced`. */
export function coalescedOf(rows: readonly Row[] | undefined): number {
  return (rows ?? []).filter((r) => r.created === false).length;
}
