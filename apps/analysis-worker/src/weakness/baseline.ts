// The rating-band baseline a recompute compares with (phase-06 plan §7.4.2 step 5, §7.4.5; signatures.md §3): the
// committed JSON (`@repo/chess-training/baselines/load`, bundled by esbuild, parsed once per process). Two refusals:
//   - a baseline graded with another engine profile than this worker's (`baseline_profile_mismatch`, FE 10.12.4);
//   - a synthetic baseline (`v0-synthetic`) for a READY snapshot when APP_ENV=production: production profiles are
//     only ever compared with the real Lichess baseline (v1).
// The default is the real J5 baseline (v1) everywhere; the id in use is recorded in `metrics.inputs.baseline`, so the UI
// can tag a synthetic one (only ever chosen explicitly, e.g. by a test).
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { assertBaselineProfile, isSyntheticBaseline, loadBaseline } from "@repo/chess-training/baselines/load";
import type { BaselineV1 } from "@repo/chess-training/baselines/schema";
import type { AppEnvName } from "../config/env";
import { JobError } from "../jobs/types";

/** The terminal failure codes of this module (`jobs."lastError"` message, `metrics.failure.code`, the PostHog event). */
export const BASELINE_PROFILE_MISMATCH = "baseline_profile_mismatch";
export const SYNTHETIC_BASELINE_REFUSED = "synthetic_baseline_refused";

/** The baseline for this worker, checked against its engine profile. Throws a terminal JobError when they differ. */
export function workerBaseline(id?: string): BaselineV1 {
  const b = loadBaseline(id);
  try {
    assertBaselineProfile(b, ENGINE_PROFILE.id);
  } catch (error) {
    throw new JobError("internal", `${BASELINE_PROFILE_MISMATCH}: baseline ${b.id} vs ${ENGINE_PROFILE.id}`, {
      terminal: true,
      cause: error,
    });
  }
  return b;
}

/** True when this READY snapshot must not be written with this baseline (APP_ENV=production + synthetic). */
export function refusesReady(appEnv: AppEnvName, b: BaselineV1): boolean {
  return appEnv === "production" && isSyntheticBaseline(b);
}
