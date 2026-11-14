"use client";

// Runner performance and error telemetry (phase-05 plan §9.6, §10.2). Two lab-gated SLOs as `performance` marks and
// measures, also sent as anonymous Sentry metrics with `{route_class, device_class}` only (no user id, no move):
//
//   train.move_verdict_ms     the board hands a move to the runner → the first paint that shows the verdict
//                             (≤ 16 ms desktop, ≤ 33 ms mid-tier phone)
//   train.grade_to_next_ms    a grade button → the first paint of the next item's board (≤ 50 / 100 ms)
//
// The Playwright perf smoke reads the measures (`rc:train-move-verdict`, `rc:train-grade-next`). A stored line that
// fails chess.js validation is captured as `train.item_broken` with the item key, never the FEN.
import { afterPaint } from "@/lib/sentry/review";
import { withSentry } from "@/lib/sentry/lazy";
import { deviceClass } from "@/lib/shell/device-class";

export const MOVE_MARK = "rc:train-move";
export const MOVE_MEASURE = "rc:train-move-verdict";
export const GRADE_MARK = "rc:train-grade";
export const GRADE_MEASURE = "rc:train-grade-next";
export const MOVE_METRIC = "train.move_verdict_ms";
export const GRADE_METRIC = "train.grade_to_next_ms";

export type RouteClass = "bank" | "puzzles";

function hasMark(name: string): boolean {
  try {
    return performance.getEntriesByName(name, "mark").length > 0;
  } catch {
    return false;
  }
}

function mark(name: string): void {
  try {
    performance.clearMarks(name);
    performance.mark(name);
  } catch {
    // No performance API (old browsers): the SLO is not measured there.
  }
}

/** Measures from `markName` to now (after the next paint) and sends the metric once. Returns the cancel function. */
function measureAfterPaint(markName: string, measureName: string, metric: string, routeClass: RouteClass): () => void {
  if (!hasMark(markName)) return () => undefined;
  return afterPaint(() => {
    if (!hasMark(markName)) return;
    try {
      const m = performance.measure(measureName, markName);
      performance.clearMarks(markName);
      const ms = Math.round(m.duration);
      const attributes = { route_class: routeClass, device_class: deviceClass() };
      withSentry((Sentry) => Sentry.metrics.distribution(metric, ms, { unit: "millisecond", attributes }));
    } catch {
      // Telemetry never breaks the runner.
    }
  });
}

export const markMoveStart = (): void => mark(MOVE_MARK);
export const markGradeStart = (): void => mark(GRADE_MARK);
export const measureMoveVerdict = (rc: RouteClass): (() => void) => measureAfterPaint(MOVE_MARK, MOVE_MEASURE, MOVE_METRIC, rc);
export const measureGradeToNext = (rc: RouteClass): (() => void) => measureAfterPaint(GRADE_MARK, GRADE_MEASURE, GRADE_METRIC, rc);

/** A stored solution that does not replay (`train.item_broken`): the item key only. */
export function captureBrokenItem(itemKey: string | null, kind: string): void {
  withSentry((Sentry) => Sentry.captureMessage("train.item_broken", { level: "warning", tags: { kind }, extra: { itemKey } }));
}
