// The drain-end queue summary (phase-03 plan §8.12, §10.2): when the next job this worker can run is due, and the
// queue gauges. Sent in the drain-end batch with the reaper (scheduler.ts); packages/db/scripts/explain-hot.ts
// EXPLAINs this very statement.
import { PROGRESS_BAND_MIN, type JobKind } from "@repo/contracts/internal/jobs";
import { stmt, type Statement } from "../db/client";
import { NOW, PAYLOAD_V_SQL } from "./claim";

/** The drain-end summary: when the next job this worker can run is due, and the queue gauges (§10.2). */
export function queueSummaryStatement(kinds: readonly JobKind[], payloadVMax: number): Statement {
  const due = `"runAt" <= ${NOW}`;
  const since = `extract(epoch FROM ${NOW} - min(GREATEST("createdAt", "runAt"))`;
  return stmt(
    `SELECT (extract(epoch FROM min("runAt")) * 1000)::float8 AS "nextRunAtMs",
            count(*) FILTER (WHERE ${due} AND priority >= $3)::int AS "depthHi",
            count(*) FILTER (WHERE ${due} AND priority < $3)::int AS "depthLo",
            COALESCE(${since} FILTER (WHERE ${due} AND priority >= $3)), 0)::float8 AS "oldestHiSec",
            COALESCE(${since} FILTER (WHERE ${due} AND priority < $3)), 0)::float8 AS "oldestLoSec"
       FROM jobs
      WHERE status = 'QUEUED' AND kind::text = ANY($1::text[]) AND ${PAYLOAD_V_SQL} <= $2`,
    [[...kinds], payloadVMax, PROGRESS_BAND_MIN],
  );
}
