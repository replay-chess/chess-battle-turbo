// HTTP contract of content reports (phase-05 plan §7.1 W7 `POST /api/reports`, api SYS-6; §0 "Content reports").
// One `reports` table and one handler: P5 writes `mistake` and `puzzle` targets; P10 adds `user` and `game` as
// discriminated branches of the same body (consistency R-02 / 5.5), later phases `coach_answer`, `lesson`, `position`.
// The registry entry lives in registry/reports.ts.
import { z } from "zod";
import { FenLoose, Ref } from "./common";

/** P5's targets. The DB enum `ReportTarget` already holds P10's values, so P10 needs no `ADD VALUE`. */
export const REPORT_TARGETS = ["mistake", "puzzle"] as const;
export const REPORT_REASONS = ["wrong_solution", "better_move", "illegal_move", "text_wrong", "other"] as const;

export const REPORT_NOTE_MAX = 500;
export const REPORT_MAX_BODY_BYTES = 4_096;

/** `report-burst` 5 / 60 s (P1 burst bucket). */
export const REPORT_BURST_LIMIT = { bucket: "report-burst", limit: 5, windowSec: 60, by: "user" } as const;
/**
 * `report` 20 / 86 400 s: durable, counted in the handler from `reports (reporterId, createdAt)` (api-perf AP-11), so
 * a Neon suspend cannot reset it; answered as 429 `rate_limited` with `details.reason: "report_limit"`.
 */
export const REPORT_DAILY = { limit: 20, windowSec: 86_400 } as const;
/** A second report of the same target by the same viewer inside this window answers 200 `duplicate: true`. */
export const REPORT_DEDUPE_WINDOW_SEC = 86_400;

/**
 * Control characters other than tab, line feed and carriage return (FIX-2): a NUL cannot be stored in a Postgres text
 * column (22021) and none of them belong in a note, so the body is a 400, never a 500.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noControl = (s: string) => !CONTROL_CHARS.test(s);

export const ReportBody = z.strictObject({
  targetType: z.enum(REPORT_TARGETS),
  /** A mistake's referenceId, or a Lichess puzzle id. */
  targetRef: z.string().min(1).max(64).refine(noControl, { message: "No control characters" }),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(REPORT_NOTE_MAX).refine(noControl, { message: "No control characters" }).optional(),
  fen: FenLoose,
});
export type ReportBody = z.infer<typeof ReportBody>;

/** 201 for a new report; 200 with `duplicate: true` when the viewer reported this target in the last 24 h. */
export const ReportResult = z.object({ ref: Ref, duplicate: z.boolean() });
export type ReportResult = z.infer<typeof ReportResult>;
