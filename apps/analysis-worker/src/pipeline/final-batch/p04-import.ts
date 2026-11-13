// P4's final-batch extension (phase-04 plan §7.7.2 "analysis hook line", §8.9, §12.2 test 13; interface check §0.7).
// Two set-based statements in the ONE transaction that finishes an analysis (types.ts rules: idempotent within the
// batch, only granted columns, pure builder):
//
//   - an analysis queued by an import (payload `importRunId`) counts in its run: `import_runs.analysed + 1`, never past
//     the run's `analysisQueued` (a no-op once the run row is pruned or when the run did not queue it). The batch
//     commits once: a resend after a lost response fails on its lock guard and rolls back (sql-store.ts).
//   - an analysis that used Lichess's evaluations records it: `game_analyses."evalSource"` LICHESS or MIXED
//     (the analysis row was written ENGINE earlier in the same batch).
//
// FIX-1: the run update RETURNs what the first-review telemetry needs (plan 9.1, 10.1, 10.2): when the game is the
// run's newest (`firstGameId`) and the run is an INITIAL import, `committed()` records the worker metric
// `import.review_ready_ms` (commit − run `startedAt`) and the PostHog event `review_ready_after_import`
// {provider, ms_since_entitled}. `ms_since_entitled` counts from when the member could expect it: the trial start
// when the run was parked for a membership and released at entitlement, else the run's creation (an already-entitled
// member's link). Both values come from the database clock in the same transaction.
import { numOrNull, stmt, type Row, type Statement } from "../../db/client";
import { importMetric } from "../../import/metrics";
import { NOW } from "../../queue/claim";
import type { FinalBatchContext, FinalBatchExtension, FinalBatchSink } from "./types";

export const p04ImportExtension: FinalBatchExtension = {
  id: "p04-import",
  statements(ctx: FinalBatchContext): Statement[] {
    const out: Statement[] = [];
    if (ctx.importRunId && !ctx.regrade) {
      out.push(
        stmt(
          `UPDATE import_runs r SET analysed = r.analysed + 1, "updatedAt" = ${NOW}
            WHERE r.id = $1::bigint AND r.analysed < r."analysisQueued"
          RETURNING r.provider::text AS provider, r.trigger::text AS trigger, (r."firstGameId" = $2::bigint) AS "isFirst",
                    (extract(epoch FROM (${NOW} - r."startedAt")) * 1000)::bigint AS "sinceStartMs",
                    (extract(epoch FROM (${NOW} - GREATEST(r."createdAt",
                       COALESCE((SELECT u."trialStartedAt" FROM users u WHERE u.id = r."userId"), r."createdAt")))) * 1000)::bigint
                      AS "sinceEntitledMs",
                    (SELECT u."referenceId" FROM users u WHERE u.id = r."userId") AS "userRef"`,
          [ctx.importRunId, ctx.gameId],
        ),
      );
    }
    if (ctx.evalSource && ctx.evalSource !== "ENGINE") {
      out.push(
        stmt(`UPDATE game_analyses SET "evalSource" = $2::"EvalSource" WHERE "gameId" = $1::bigint`, [
          ctx.gameId,
          ctx.evalSource,
        ]),
      );
    }
    return out;
  },
  committed(ctx: FinalBatchContext, rows: readonly Row[][], sink: FinalBatchSink): void {
    if (!ctx.importRunId || ctx.regrade) return;
    const run = rows[0]?.[0];
    if (!run || run.isFirst !== true || run.trigger !== "INITIAL") return;
    const provider = run.provider === "LICHESS" ? "lichess" : "chesscom";
    const sinceStart = numOrNull(run.sinceStartMs);
    if (sinceStart !== null) importMetric(sink, "import.review_ready_ms", Math.max(0, sinceStart), { provider });
    const sinceEntitled = numOrNull(run.sinceEntitledMs);
    const userRef = typeof run.userRef === "string" ? run.userRef : null;
    if (userRef && sinceEntitled !== null) {
      sink.events.capture("review_ready_after_import", userRef, {
        provider,
        ms_since_entitled: Math.min(REVIEW_READY_MAX_MS, Math.max(0, Math.round(sinceEntitled))),
      });
    }
  },
};

/** The event schema's ceiling for `ms_since_entitled` (30 days, @repo/analytics events/import.ts). */
const REVIEW_READY_MAX_MS = 30 * 86_400_000;
