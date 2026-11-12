// Claim (phase-03 plan §8.12 "Claim", DM §5.4): one statement over Neon HTTP, safe through the pooler. The highest
// priority first, then the per-user ordinal (`fairSeq`, so a backfill interleaves users), then the oldest `runAt`.
// `FOR UPDATE SKIP LOCKED` lets two workers claim side by side without ever taking the same row (claim.int.test.ts).
//
// Rollback safety (FEA §9): a job whose payload `v` is above what this build reads (PAYLOAD_V_MAX) is never claimed;
// it waits for the newer image. A non-numeric `v` counts as 1, so the claim is never broken by a bad row: that row
// is claimed and failed as `invalid` by the runner.
import type { JobKind } from "@repo/contracts/internal/jobs";
import { idOrNull, idStr, num, stmt, type Db, type Statement } from "../db/client";

/** `(now() AT TIME ZONE 'UTC')`: Prisma DateTime columns are timestamp(3) without zone, stored in UTC. */
export const NOW = `(now() AT TIME ZONE 'UTC')`;

/** The payload version of a row; a non-number counts as 1 (the runner then fails the row as invalid). */
export const PAYLOAD_V_SQL = `COALESCE(CASE WHEN jsonb_typeof(payload->'v') = 'number' THEN (payload->>'v')::numeric END, 1)`;

export interface ClaimedJob {
  /** jobs.id as a decimal string (int8). */
  id: string;
  kind: JobKind;
  payload: unknown;
  /** Including this claim. */
  attempts: number;
  maxAttempts: number;
  priority: number;
  gameId: string | null;
  userId: string | null;
  runAtMs: number;
  createdAtMs: number;
  /** When this worker claimed it (the queue wait = claimedAtMs − max(runAt, createdAt)). */
  claimedAtMs: number;
}

const CLAIM_RETURNING = `id::text AS id, kind::text AS kind, payload, attempts, "maxAttempts", priority,
            "gameId"::text AS "gameId", "userId"::text AS "userId",
            (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
            (extract(epoch FROM "createdAt") * 1000)::float8 AS "createdAtMs",
            (extract(epoch FROM "lockedAt") * 1000)::float8 AS "claimedAtMs"`;

const CLAIM_NEXT = `UPDATE jobs
        SET status = 'RUNNING', "lockedBy" = $1, "lockedAt" = ${NOW}, "heartbeatAt" = ${NOW},
            "startedAt" = COALESCE("startedAt", ${NOW}), attempts = attempts + 1
      WHERE id = (SELECT id FROM jobs
                   WHERE status = 'QUEUED' AND "runAt" <= ${NOW} AND kind::text = ANY($2::text[])
                     AND ${PAYLOAD_V_SQL} <= $3
                   ORDER BY priority DESC, "fairSeq", "runAt"
                   LIMIT 1
                   FOR UPDATE SKIP LOCKED)`;

/**
 * The claim. It is not idempotent (it takes a new row and counts an attempt), so an ambiguous failure, where the
 * claim may have committed and only the response was lost, is retried with `adoptOrClaimStatement`, never with
 * itself: a blind second claim would take a second row and leave the first RUNNING under this worker with nobody
 * running it (FIX-1, `claim.int.test.ts` "a lost claim response").
 *
 * `known`: ids of the rows this boot has already been handed by a claim since its last drain-end reap. The retry form
 * never adopts one of them (see `adoptOrClaimStatement`).
 */
export function claimStatement(
  me: string,
  kinds: readonly JobKind[],
  payloadVMax: number,
  known: readonly string[] = [],
): Statement {
  return {
    ...stmt(`${CLAIM_NEXT}\n  RETURNING ${CLAIM_RETURNING}`, [me, [...kinds], payloadVMax]),
    retry: adoptOrClaimStatement(me, kinds, payloadVMax, known),
  };
}

/**
 * The claim's retry form. The worker runs one job at a time and claims only between jobs, so a RUNNING row held by
 * this boot (`lockedBy` = me) that no claim has handed to it yet can only be the row a claim whose response was lost
 * took: adopt it (fresh heartbeat, the attempt it already counted). Without one, claim the next row as usual. One
 * statement; the claim branch runs only when there is nothing to adopt.
 *
 * A row this boot was already handed can also still be RUNNING under it: a job whose fail write failed on both
 * attempts stays locked until the drain-end reaper requeues it (runner.ts `fail`). Adopting that row would run the
 * failed attempt again at once, uncounted and without its back-off, while the due row waits, so the ids in `known`
 * (the rows handed out since the last drain-end reap, scheduler.ts) are never adopted (regression:
 * adopt-stranded-row, FIX-2).
 */
export function adoptOrClaimStatement(
  me: string,
  kinds: readonly JobKind[],
  payloadVMax: number,
  known: readonly string[] = [],
): Statement {
  return {
    ...stmt(
      `WITH adopted AS (
  UPDATE jobs SET "heartbeatAt" = ${NOW}
   WHERE id = (SELECT id FROM jobs WHERE status = 'RUNNING' AND "lockedBy" = $1 AND id <> ALL($4::bigint[])
                ORDER BY "lockedAt" DESC LIMIT 1 FOR UPDATE)
  RETURNING ${CLAIM_RETURNING}
), claimed AS (
  ${CLAIM_NEXT.replace("WHERE id = (SELECT id FROM jobs", "WHERE NOT EXISTS (SELECT 1 FROM adopted) AND id = (SELECT id FROM jobs")}
  RETURNING ${CLAIM_RETURNING}
)
SELECT * FROM adopted UNION ALL SELECT * FROM claimed`,
      [me, [...kinds], payloadVMax, [...known]],
    ),
    retry: "never",
  };
}

export function toClaimedJob(row: Record<string, unknown>): ClaimedJob {
  return {
    id: idStr(row.id),
    kind: row.kind as JobKind,
    payload: row.payload,
    attempts: num(row.attempts),
    maxAttempts: num(row.maxAttempts),
    priority: num(row.priority),
    gameId: idOrNull(row.gameId),
    userId: idOrNull(row.userId),
    runAtMs: num(row.runAtMs),
    createdAtMs: num(row.createdAtMs),
    claimedAtMs: num(row.claimedAtMs),
  };
}

/**
 * Claims the next due job of `kinds`, or null when there is none. `known`: the rows this boot was handed since its
 * last drain-end reap (never adopted by the retry form).
 */
export async function claimJob(
  db: Db,
  me: string,
  kinds: readonly JobKind[],
  payloadVMax: number,
  known: readonly string[] = [],
): Promise<ClaimedJob | null> {
  if (kinds.length === 0) return null;
  const rows = await db.query(claimStatement(me, kinds, payloadVMax, known));
  return rows[0] ? toClaimedJob(rows[0]) : null;
}
