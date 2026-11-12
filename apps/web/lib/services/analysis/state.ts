// The analysis state of one game as the review API reports it (phase-03 plan §5.2, §7.2 A1/A2, §8.12 "Stall rule").
// Pure: every function here reads the columns the probe / review / status statements return (lib/services/analysis/
// review-sql.ts) and the request time, so A1, A2, the RSC page and the tests agree on one mapping.
//
// Status (wire, lowercase): games."analysisStatus" is the truth, refined by the job row:
//   SKIPPED → skipped · a RUNNING job → running, or failed `worker_stalled` (retryable) when its heartbeat is older
//   than WORKER_STALL_HEARTBEAT_MS (A2 reports it before the reaper runs) · DONE → done · FAILED → failed (retryable
//   while the job is QUEUED with attempts left: the worker's back-off; terminal otherwise) · QUEUED → queued (a job
//   that is already DONE, FAILED or CANCELLED wins: done / failed terminal) · NONE → none (queued if a job is live).
import {
  ANALYSIS_FAILURE_CODES,
  WORKER_STALL_HEARTBEAT_MS,
  type AnalysisFailureCode,
  type AnalysisStatusWire,
  type ReviewFailure,
} from "@repo/contracts/http/review";
import { analysisEtaSec } from "@repo/contracts/internal/jobs";
import { KICK_CAS_WINDOW_MS } from "@repo/contracts/internal/kick";

export type DbAnalysisStatus = "NONE" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
export type DbJobStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";

/** The job columns every review statement selects (`jobs` row of `analyze:<gameId>`, or all null). */
export type JobState = {
  jobStatus: DbJobStatus | null;
  attempts: number | null;
  maxAttempts: number | null;
  runAt: Date | null;
  heartbeatAt: Date | null;
  lastKickAt: Date | null;
  lastError: string | null;
};

export type AnalysisStateInput = JobState & {
  analysisStatus: DbAnalysisStatus;
  gradedPlies: number | null;
  failedAtPly: number | null;
};

export type AnalysisState = {
  status: AnalysisStatusWire;
  /** Set when status is `failed`. */
  failure: ReviewFailure | null;
};

const ms = (d: Date | string | null | undefined): number | null => (d == null ? null : new Date(d).getTime());

/** "<code>: <short message>" (jobs."lastError") → a wire failure code; anything else is `internal`. */
export function failureCodeOf(lastError: string | null | undefined): AnalysisFailureCode {
  const code = (lastError ?? "").split(":")[0]?.trim() ?? "";
  return (ANALYSIS_FAILURE_CODES as readonly string[]).includes(code) ? (code as AnalysisFailureCode) : "internal";
}

/** The job is RUNNING and its heartbeat (or lock) is older than the stall window. */
export function isStalled(job: Pick<JobState, "jobStatus" | "heartbeatAt">, nowMs: number): boolean {
  if (job.jobStatus !== "RUNNING") return false;
  const beat = ms(job.heartbeatAt);
  return beat === null || nowMs - beat > WORKER_STALL_HEARTBEAT_MS;
}

export function analysisStateOf(input: AnalysisStateInput, nowMs: number): AnalysisState {
  const failedAt = Math.max(0, input.failedAtPly ?? input.gradedPlies ?? 0);
  const job = input.jobStatus;
  if (input.analysisStatus === "SKIPPED") return { status: "skipped", failure: null };
  if (job === "RUNNING") {
    if (isStalled(input, nowMs)) {
      return {
        status: "failed",
        failure: { failedAtPly: Math.max(0, input.gradedPlies ?? 0), retryable: true, retryAt: null, code: "worker_stalled" },
      };
    }
    return { status: "running", failure: null };
  }
  const terminal = (): AnalysisState => ({
    status: "failed",
    failure: { failedAtPly: failedAt, retryable: false, retryAt: null, code: failureCodeOf(input.lastError) },
  });
  switch (input.analysisStatus) {
    case "DONE":
      return { status: "done", failure: null };
    case "FAILED": {
      const retryable = job === "QUEUED" && (input.attempts ?? 0) < (input.maxAttempts ?? 0);
      if (!retryable) return terminal();
      const retryAt = ms(input.runAt);
      return {
        status: "failed",
        failure: {
          failedAtPly: failedAt,
          retryable: true,
          retryAt: retryAt === null ? null : new Date(retryAt).toISOString(),
          code: failureCodeOf(input.lastError),
        },
      };
    }
    case "QUEUED":
    case "RUNNING":
      if (job === "DONE") return { status: "done", failure: null };
      if (job === "FAILED" || job === "CANCELLED") return terminal();
      return { status: input.analysisStatus === "RUNNING" ? "running" : "queued", failure: null };
    case "NONE":
      return job === "QUEUED" ? { status: "queued", failure: null } : { status: "none", failure: null };
  }
}

// ── ETA (§5.2 "queue", A2 `etaSec`, A3/A4 responses): the shared model in @repo/contracts/internal/jobs ───────────
/** Seconds until the analysis is ready, for a job `position` places back with `gradedPlies` of `totalPlies` done. */
export function etaSecFor(input: { position: number; totalPlies: number; gradedPlies: number }): number {
  return analysisEtaSec({ ahead: input.position, remainingPlies: input.totalPlies - input.gradedPlies });
}

// ── The lost-kick heal (§7.3 healKick, AP-09) ────────────────────────────────────────────────────────────────────
/**
 * True when a read should try the kick compare-and-set: the job is QUEUED, due for more than the CAS window, and was
 * not kicked within it. The CAS in SQL decides (`healKick`); this only avoids a write when it cannot succeed.
 */
export function needsHealKick(job: Pick<JobState, "jobStatus" | "runAt" | "lastKickAt">, nowMs: number): boolean {
  if (job.jobStatus !== "QUEUED") return false;
  const runAt = ms(job.runAt);
  if (runAt === null || nowMs - runAt <= KICK_CAS_WINDOW_MS) return false;
  const kicked = ms(job.lastKickAt);
  return kicked === null || nowMs - kicked > KICK_CAS_WINDOW_MS;
}
