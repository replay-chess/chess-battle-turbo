// HOUSEKEEPING (phase-03 plan §7.7, P3-D22): once a day at 21:00 UTC.
//
//   1. every slice's `run()` in order (≤ 60 s each; an error is recorded and the others still run);
//   2. ONE batch behind the lock guard: DAILY_PLAN's timed rows for the next 26 h (tomorrow's HOUSEKEEPING too), every
//      slice's set-based `statements()` (the prunes, the regrade search), and the DONE flag when nothing failed;
//   3. every slice's `after()` with the rows its statements returned (logs, the regrade enqueues).
//
// So the daily wake costs the claim, this batch, and the drain's own claim + drain-end batch (the timer audit). When
// the batch fails as a whole, the plan rows are written alone in a second request before the job fails, so a broken
// prune can never lose tomorrow's row. A failed slice fails the job after the plan is written, so it retries (2
// attempts). Sentry cron monitor `housekeeping`: check-ins at start and end.
//
// A batch that committed but whose response was lost is retried by the client, and that retry's lock guard fails
// with 22012 because the first attempt already marked the job DONE. As in the analysis final batch (sql-store.ts
// `finalBatch`), that is not a lost lock: when the job is DONE by this worker the batch committed, so the slices'
// statements are read again without the guard and DONE (the plan inserts and the prunes are idempotent, the regrade
// search is a read) and the `after()` hooks and the "ok" check-in still run (regression: lost-housekeeping-response,
// FIX-2).
import type { Clock } from "../scheduler/clock";
import { collectPlan, planWindow } from "../scheduler/daily-plan";
import { RECURRING_SLICES, type HousekeepingCtx, type RecurringSlice } from "../scheduler/recurring";
import { doneByMeStatement, doneStatement, isLockLost, lockGuardStatement } from "../queue/outcome";
import { wasRetried, type Row, type Statement } from "../db/client";
import { JobError, throwIfAborted, type JobHandler } from "./types";

/** Each slice's `run()` gets this long (§7.7). */
export const SLICE_TIMEOUT_MS = 60_000;

class SliceTimeout extends Error {
  constructor(id: string) {
    super(`slice ${id} took longer than ${SLICE_TIMEOUT_MS / 1000} s`);
    this.name = "SliceTimeout";
  }
}

function withTimeout<T>(clock: Clock, id: string, work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = clock.setTimeout(() => reject(new SliceTimeout(id)), ms);
    work.then(
      (v) => {
        clock.clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clock.clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function housekeepingHandler(
  slices: readonly RecurringSlice[] = RECURRING_SLICES,
  sliceTimeoutMs = SLICE_TIMEOUT_MS,
): JobHandler<"HOUSEKEEPING"> {
  return {
    kind: "HOUSEKEEPING",
    async run(ctx) {
      const checkInId = ctx.telemetry.cronCheckIn("housekeeping", "in_progress");
      const startedMs = ctx.clock.now();
      const hctx: HousekeepingCtx = {
        db: ctx.db,
        clock: ctx.clock,
        log: ctx.log,
        metrics: ctx.metrics,
        signal: ctx.signal,
        now: new Date(startedMs),
        evalCache: ctx.evalCache,
        evalCacheMaxBytes: ctx.evalCacheMaxBytes,
      };
      const failed: string[] = [];
      for (const slice of slices) {
        if (!slice.run) continue;
        throwIfAborted(ctx.signal);
        const t0 = ctx.clock.now();
        try {
          await withTimeout(ctx.clock, slice.id, slice.run(hctx), sliceTimeoutMs);
          ctx.log.info("housekeeping slice done", { slice: slice.id, ms: ctx.clock.now() - t0 });
        } catch (error) {
          failed.push(slice.id);
          ctx.log.error("housekeeping slice failed", { slice: slice.id, error });
          ctx.telemetry.captureException(error, { kind: "HOUSEKEEPING", slice: slice.id });
        }
      }
      throwIfAborted(ctx.signal);
      const plan = collectPlan(slices, planWindow(ctx.clock.now()), ctx.log);
      failed.push(...plan.errors.map((e) => `${e.slice}.plan`));
      const sliceStatements: { slice: RecurringSlice; statements: Statement[] }[] = [];
      for (const slice of slices) {
        if (!slice.statements) continue;
        try {
          sliceStatements.push({ slice, statements: slice.statements(hctx) });
        } catch (error) {
          failed.push(`${slice.id}.statements`);
          ctx.log.error("housekeeping slice statements failed", { slice: slice.id, error });
        }
      }
      let ok = failed.length === 0;
      const extra = sliceStatements.flatMap((s) => s.statements);
      let out: Row[][];
      try {
        out = await ctx.db.batch([
          lockGuardStatement(ctx.job.id, ctx.me),
          ...plan.statements,
          ...extra,
          ...(ok ? [doneStatement(ctx.job.id, ctx.me, { day: ctx.payload.day, planned: plan.rows.length })] : []),
        ]);
      } catch (error) {
        const committed =
          ok && isLockLost(error) && wasRetried(error)
            ? (await ctx.db.query(doneByMeStatement(ctx.job.id, ctx.me))).length > 0
            : false;
        if (committed) {
          ctx.log.warn("housekeeping batch committed but its response was lost: reading the slices' rows again");
          // The batch's row layout (the guard's row, the plan's, the slices', DONE's) for the follow-ups below.
          out = [[], ...(await ctx.db.batch([...plan.statements, ...extra])), []];
        } else {
          if (isLockLost(error)) throw error;
          ctx.log.error("housekeeping batch failed: writing the plan alone", { error });
          ctx.telemetry.captureException(error, { kind: "HOUSEKEEPING" });
          await ctx.db.batch([lockGuardStatement(ctx.job.id, ctx.me), ...plan.statements]);
          failed.push("batch");
          ok = false;
          out = [];
        }
      }
      ctx.heartbeat.noteWrite();
      let at = 1 + plan.statements.length;
      for (const { slice, statements } of sliceStatements) {
        const rows = out.slice(at, at + statements.length);
        at += statements.length;
        if (!slice.after || rows.length !== statements.length) continue;
        try {
          await withTimeout(ctx.clock, slice.id, slice.after(hctx, rows), sliceTimeoutMs);
        } catch (error) {
          // The day's batch is committed; the slice's follow-up retries tomorrow.
          ctx.log.error("housekeeping slice follow-up failed", { slice: slice.id, error });
          ctx.telemetry.captureException(error, { kind: "HOUSEKEEPING", slice: slice.id });
        }
      }
      if (!ok) {
        ctx.telemetry.cronCheckIn("housekeeping", "error", checkInId);
        throw new JobError("internal", `housekeeping slices failed: ${failed.join(", ")}`);
      }
      ctx.metrics.lastHousekeepingAtMs = ctx.clock.now();
      ctx.telemetry.cronCheckIn("housekeeping", "ok", checkInId);
      ctx.log.info("housekeeping done", {
        day: ctx.payload.day,
        planned: plan.rows.length,
        ms: ctx.clock.now() - startedMs,
      });
      return "done";
    },
  };
}
