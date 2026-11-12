// DAILY_PLAN (phase-03 plan §7.7 step 6, P3-D22): collects `plan(window = now → now + 26 h)` from every recurring
// slice and inserts the timed rows with `ON CONFLICT ("dedupeKey") DO NOTHING` (enqueueJob's `keep` policy). It runs
// as the last step of HOUSEKEEPING and inside the boot batch (so a fresh database gets its first HOUSEKEEPING row),
// costing no round trip of its own. A slice whose plan() throws is logged and skipped; the others are still planned.
import { enqueueJobSql } from "@repo/db/jobs";
import { fromPrisma, type Statement } from "../db/client";
import type { Logger } from "../obs/log";
import type { JobRowInput, PlanWindow, RecurringSlice } from "./recurring/types";

/** The planning horizon: 26 h covers tomorrow's 21:00 even when today's run starts late. */
export const PLAN_WINDOW_MS = 26 * 60 * 60 * 1000;

export function planWindow(nowMs: number): PlanWindow {
  return { from: new Date(nowMs), to: new Date(nowMs + PLAN_WINDOW_MS) };
}

export interface CollectedPlan {
  rows: JobRowInput[];
  /** One insert per row, in order (each row was validated by building it). */
  statements: Statement[];
  errors: { slice: string; error: unknown }[];
}

export function collectPlan(slices: readonly RecurringSlice[], window: PlanWindow, log?: Logger): CollectedPlan {
  const rows: JobRowInput[] = [];
  const statements: Statement[] = [];
  const errors: CollectedPlan["errors"] = [];
  for (const slice of slices) {
    if (!slice.plan) continue;
    try {
      // A slice's rows go in together or not at all: build every statement before keeping any.
      const planned = slice.plan(window);
      const built = planned.map((row) => {
        if (!row.dedupeKey) throw new Error(`slice ${slice.id} planned a row without a dedupeKey`);
        return insertStatement(row);
      });
      rows.push(...planned);
      statements.push(...built);
    } catch (error) {
      errors.push({ slice: slice.id, error });
      log?.error("daily plan slice failed", { slice: slice.id, error });
    }
  }
  return { rows, statements, errors };
}

/** `INSERT … ON CONFLICT ("dedupeKey") DO NOTHING` (validated by @repo/db's enqueue builder; throws on a bad row). */
export function insertStatement(row: JobRowInput): Statement {
  return fromPrisma(enqueueJobSql({ ...row, onConflict: "keep" }));
}
