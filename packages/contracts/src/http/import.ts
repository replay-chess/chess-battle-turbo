// Import status and retry contracts (phase-04 plan §7.4 ACC-7, ACC-8; D4-31). `GET /api/import/status` never
// enqueues: its only write is the registered `kick_cas` (P3's compare-and-set on jobs."lastKickAt").
import { z } from "zod";
import { RunView } from "./accounts";
import { Ref } from "./common";
import { AnalysisStatusWire } from "./review";

/** Runs shown by ACC-7 (newest first). */
export const IMPORT_STATUS_RUNS_MAX = 5;
/** A run QUEUED longer than this is re-kicked through the kick CAS (D4-31, the same window as P3's A1/A2). */
export const IMPORT_STALE_QUEUED_MS = 30_000;

/** The newest imported game's review (Done / Home "first review" card). */
export const FirstReview = z.object({
  gameRef: Ref,
  analysisStatus: AnalysisStatusWire,
  momentsCount: z.int().min(0).nullable(),
});
export type FirstReview = z.infer<typeof FirstReview>;

/** ACC-7. `firstReview` comes from the newest run that has a `firstGameId`. */
export const ImportStatusData = z.object({
  runs: z.array(RunView).max(IMPORT_STATUS_RUNS_MAX),
  firstReview: FirstReview.nullable(),
});
export type ImportStatusData = z.infer<typeof ImportStatusData>;

/** ACC-8 path. */
export const RunRefParams = z.object({ ref: Ref });
export type RunRefParams = z.infer<typeof RunRefParams>;

/** ACC-8 has no body; an empty or `{}` body is accepted. */
export const RetryImportBody = z.strictObject({}).default({});

export const RetryImportData = z.object({ run: RunView });
export type RetryImportData = z.infer<typeof RetryImportData>;
