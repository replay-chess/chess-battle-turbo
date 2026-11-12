// HOUSEKEEPING slice 5 (phase-03 plan §7.6, §8.14): after a GRADING_VERSION bump, re-grade up to 200 outdated
// analyses a day, newest games first, at HOUSEKEEPING priority (below every user-facing job). The search for them
// rides in HOUSEKEEPING's batch; when it finds any, each enqueue is the shared `enqueueAnalysisSql` (@repo/db/jobs,
// reason "regrade": it revives the DONE job, moves the game to QUEUED and bumps the members' archive version), sent in
// batches of 50 per round trip. The jobs are due at once, so the same drain picks them up after HOUSEKEEPING; they
// are engine-free while the profile is unchanged (§8.14). A failed enqueue is retried by the next day's sweep.
import { GRADING_VERSION } from "@repo/chess-analysis/version";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { fromPrisma, stmt, type Statement } from "../../db/client";
import type { RecurringSlice } from "./types";

export const REGRADE_SWEEP_MAX = 200;
export const REGRADE_BATCH = 50;

export function outdatedAnalysesStatement(version: number, limit: number): Statement {
  return stmt(
    `SELECT g.id::text AS id, g."referenceId" AS ref
   FROM game_analyses a JOIN games g ON g.id = a."gameId"
  WHERE a.version < $1 AND a."completedAt" IS NOT NULL AND g.status = 'COMPLETED' AND g."analysisStatus" = 'DONE'
  ORDER BY g."completedAt" DESC NULLS LAST, g.id DESC
  LIMIT $2`,
    [version, limit],
  );
}

export function regradeEnqueueStatement(gameId: string, gameRef: string): Statement {
  return fromPrisma(
    enqueueAnalysisSql({ gameId: BigInt(gameId), gameRef, priority: JOB_PRIORITY.HOUSEKEEPING, reason: "regrade" }),
  );
}

export function regradeSweep(version = GRADING_VERSION, max = REGRADE_SWEEP_MAX): RecurringSlice {
  return {
    id: "regrade-sweep",
    statements: () => [outdatedAnalysesStatement(version, max)],
    async after(ctx, [rows = []]) {
      let enqueued = 0;
      for (let i = 0; i < rows.length && !ctx.signal.aborted; i += REGRADE_BATCH) {
        const chunk = rows.slice(i, i + REGRADE_BATCH).map((r) => regradeEnqueueStatement(String(r.id), String(r.ref)));
        const out = await ctx.db.batch(chunk);
        enqueued += out.filter((r) => r[0] && r[0].kept !== true).length;
      }
      ctx.log.info("regrade sweep", { outdated: rows.length, enqueued });
    },
  };
}
