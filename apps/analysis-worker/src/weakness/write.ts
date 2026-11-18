// RECOMPUTE_WEAKNESS step 9 (phase-06 plan §7.4.2, Q-W10): the snapshot upsert and the version bump, in the handler's
// ONE final batch (lock guard → heal update → snapshot → [bump] → completion), and the FAILED write of the final
// failed attempt. `weekStart` is the Monday of the member's local week (TRN weekStartOf, Intl), one row per member
// and week (12 kept: the daily slice prunes). A failure never hides a good profile: the FAILED write is skipped when a
// READY row exists in any week, and an upsert never turns a READY row into FAILED.
import { ALGO_VERSION } from "@repo/chess-training/weakness/constants";
import type { WeaknessSnapshotDraft } from "@repo/chess-training/weakness/compute";
import { weaknessSnapshotKey } from "@repo/chess-training/weakness/payload";
import type { SnapshotStatus, TimeClassW, WeaknessMetricsV1 } from "@repo/chess-training/weakness/types";
import { buildWeaknessMetrics } from "@repo/db/json";
import { num, numOrNull, stmt, type Row, type Statement } from "../db/client";
import { NOW } from "../queue/claim";

/** The stored status (TRN's `SnapshotStatus`; COMPUTING is never written). */
export type SnapshotStatusDb = SnapshotStatus;

export interface SnapshotWrite {
  userId: string;
  weekStart: string;
  status: SnapshotStatusDb;
  timeClasses: readonly TimeClassW[];
  since: Date | null;
  gamesInScope: number;
  gamesAnalysed: number;
  ratingBandMin: number | null;
  ratingBandMax: number | null;
  metrics: WeaknessMetricsV1;
  headline: string | null;
}

const HEADLINE_MAX = 200;
const RETURNING = `RETURNING to_char("weekStart", 'YYYY-MM-DD') AS "weekStart", status::text AS status,
            (extract(epoch FROM "computedAt") * 1000)::float8 AS "computedAtMs"`;

function values(w: SnapshotWrite): unknown[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.weekStart)) throw new RangeError("weekStart must be YYYY-MM-DD");
  // The document is validated against THE schema before it is written (@repo/db/json, CT weakness-metrics).
  const metrics = buildWeaknessMetrics(w.metrics);
  return [
    w.userId,
    w.weekStart,
    ALGO_VERSION,
    w.status,
    [...w.timeClasses],
    w.since ? w.since.toISOString() : null,
    Math.min(32_767, w.gamesInScope),
    Math.min(32_767, w.gamesAnalysed),
    w.ratingBandMin,
    w.ratingBandMax,
    JSON.stringify(metrics),
    w.headline === null ? null : w.headline.slice(0, HEADLINE_MAX),
  ];
}

const COLUMNS = `("userId", "weekStart", "algoVersion", status, "timeClasses", since, "gamesInScope", "gamesAnalysed",
                                "ratingBandMin", "ratingBandMax", metrics, headline, "computedAt")`;
const VALUES = `$1::bigint, $2::date, $3::smallint, $4::"WeaknessStatus", $5::text[]::"TimeClass"[],
        ($6::timestamptz AT TIME ZONE 'UTC'), $7::smallint, $8::smallint, $9::smallint, $10::smallint, $11::jsonb, $12,
        ${NOW}`;
const UPDATE_SET = `"algoVersion" = EXCLUDED."algoVersion", status = EXCLUDED.status, "timeClasses" = EXCLUDED."timeClasses",
       since = EXCLUDED.since, "gamesInScope" = EXCLUDED."gamesInScope", "gamesAnalysed" = EXCLUDED."gamesAnalysed",
       "ratingBandMin" = EXCLUDED."ratingBandMin", "ratingBandMax" = EXCLUDED."ratingBandMax", metrics = EXCLUDED.metrics,
       headline = EXCLUDED.headline, "computedAt" = EXCLUDED."computedAt"`;

/** Q-W10 part 1: READY or INSUFFICIENT for this week (never over a READY row with FAILED). One row back. */
export function snapshotUpsertStatement(w: SnapshotWrite): Statement {
  return stmt(
    `INSERT INTO weakness_snapshots ${COLUMNS}
VALUES (${VALUES})
ON CONFLICT ("userId", "weekStart") DO UPDATE SET
       ${UPDATE_SET}
 WHERE NOT (weakness_snapshots.status = 'READY' AND EXCLUDED.status = 'FAILED')
${RETURNING}`,
    values(w),
  );
}

/** The final failure (§7.4.2 "Retries and failure"): FAILED only when the member has no READY row in any week. */
export function failedSnapshotStatement(w: SnapshotWrite): Statement {
  return stmt(
    `INSERT INTO weakness_snapshots ${COLUMNS}
SELECT ${VALUES}
 WHERE NOT EXISTS (SELECT 1 FROM weakness_snapshots r WHERE r."userId" = $1::bigint AND r.status = 'READY')
ON CONFLICT ("userId", "weekStart") DO UPDATE SET
       ${UPDATE_SET}
 WHERE weakness_snapshots.status <> 'READY'
${RETURNING}`,
    values({ ...w, status: "FAILED" }),
  );
}

/**
 * Q-W10 part 2, only when the version rule bumps (§8.16): `training_profiles."weaknessVersion"` + 1 (the row is created
 * when the member has none; `"updatedAt"` has no default, interface check §0.14).
 */
export function bumpVersionStatement(userId: string): Statement {
  return stmt(
    `INSERT INTO training_profiles ("userId", "weaknessVersion", "updatedAt") VALUES ($1::bigint, 1, ${NOW})
ON CONFLICT ("userId") DO UPDATE SET "weaknessVersion" = training_profiles."weaknessVersion" + 1, "updatedAt" = ${NOW}
RETURNING "weaknessVersion"`,
    [userId],
  );
}

/** After a lost response of a committed batch: the newest snapshot and the version, for the `weakness:ready` emit. */
export function snapshotReadBackStatement(userId: string): Statement {
  return stmt(
    `SELECT to_char(ws."weekStart", 'YYYY-MM-DD') AS "weekStart", ws.status::text AS status,
        (extract(epoch FROM ws."computedAt") * 1000)::float8 AS "computedAtMs",
        (SELECT tp."weaknessVersion" FROM training_profiles tp WHERE tp."userId" = ws."userId") AS "weaknessVersion"
   FROM weakness_snapshots ws WHERE ws."userId" = $1::bigint ORDER BY ws."weekStart" DESC LIMIT 1`,
    [userId],
  );
}

export interface WrittenSnapshot {
  weekStart: string;
  status: SnapshotStatusDb;
  computedAtMs: number;
  /** `{weekStart}.{computedAt base36}` (the ETag part and the `weakness:ready` dedupe key). */
  snapshotKey: string;
}

export function toWrittenSnapshot(row: Row | undefined): WrittenSnapshot | null {
  if (!row || typeof row.weekStart !== "string") return null;
  const computedAtMs = num(row.computedAtMs);
  const status = row.status === "READY" || row.status === "INSUFFICIENT" || row.status === "FAILED" ? row.status : null;
  if (!status) return null;
  return { weekStart: row.weekStart, status, computedAtMs, snapshotKey: weaknessSnapshotKey(row.weekStart, new Date(computedAtMs)) };
}

export function versionOf(row: Row | undefined): number | null {
  return row ? numOrNull(row.weaknessVersion) : null;
}

/** A draft from computeWeakness as the write's input. */
export function writeOf(userId: string, weekStart: string, d: WeaknessSnapshotDraft): SnapshotWrite {
  return {
    userId,
    weekStart,
    status: d.status,
    timeClasses: d.timeClasses,
    since: d.since,
    gamesInScope: d.gamesInScope,
    gamesAnalysed: d.gamesAnalysed,
    ratingBandMin: d.ratingBandMin,
    ratingBandMax: d.ratingBandMax,
    metrics: d.metrics,
    headline: d.headline,
  };
}
