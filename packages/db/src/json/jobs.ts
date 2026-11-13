// JSON column registry entry for jobs.payload of the P4 kinds (phase-04 plan 6.4). The schemas live in
// @repo/contracts/internal/jobs (P3's single source for every job payload, read by the web, the worker and the
// enqueue builder in ../jobs.ts); this file re-exports the P4 ones so the registry lists every JSON column shape.
export {
  AnalyzeGamePayloadV1,
  EvalHint,
  ImportPurgePayloadV1,
  ImportSyncPayloadV1,
  IMPORT_TRIGGERS_DB,
  type ImportTriggerDb,
} from "@repo/contracts/internal/jobs";
