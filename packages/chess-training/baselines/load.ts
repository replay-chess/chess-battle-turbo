// The baseline loader (phase-06 plan §7.4.2 step 5, §7.4.5; signatures.md §3). Each committed baseline is imported
// as JSON (bundled into the worker by esbuild; no file system access) and parsed once per process. `v1` is the real
// baseline J5 built from the 2026-10 Lichess dump with the worker's pinned engine (v1.meta.json; runbook
// docs/runbooks/weakness-baseline.md) and the default; `v0-synthetic` stays for tests and design states, and the
// worker refuses to write READY snapshots with it when APP_ENV=production.
import v0Synthetic from "./v0-synthetic.json" with { type: "json" };
import v1 from "./v1.json" with { type: "json" };
import { type BaselineV1, parseBaseline } from "./schema";

const RAW: Readonly<Record<string, unknown>> = {
  "v0-synthetic": v0Synthetic,
  v1,
};

/** The baseline a recompute uses unless told otherwise. */
export const DEFAULT_BASELINE_ID = "v1";

const parsed = new Map<string, BaselineV1>();

/** Every committed baseline id. */
export function baselineIds(): string[] {
  return Object.keys(RAW);
}

/** A committed baseline, parsed and validated once per process. Throws on an unknown id or an invalid file. */
export function loadBaseline(id: string = DEFAULT_BASELINE_ID): BaselineV1 {
  const hit = parsed.get(id);
  if (hit) return hit;
  const raw = RAW[id];
  if (raw === undefined) throw new Error(`unknown baseline "${id}" (have ${baselineIds().join(", ")})`);
  const b = parseBaseline(raw);
  if (b.id !== id) throw new Error(`baseline file "${id}" declares id "${b.id}"`);
  parsed.set(id, b);
  return b;
}

/** The pin (plan §7.4.2 step 5, FE 10.12.4): a baseline graded with another engine profile is refused. */
export function assertBaselineProfile(b: BaselineV1, engineProfileId: string): void {
  if (b.profile !== engineProfileId) {
    throw new Error(`baseline_profile_mismatch: baseline "${b.id}" was graded with "${b.profile}", the worker runs "${engineProfileId}"`);
  }
}

/** True for a synthetic baseline (never used for production snapshots). */
export function isSyntheticBaseline(b: BaselineV1): boolean {
  return b.synthetic;
}
