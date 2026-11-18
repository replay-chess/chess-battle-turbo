// JSON column registry entry of M6 (phase-06 plan 6.3; data-model §2.6, §9): weakness_snapshots.metrics
// (WeaknessMetricsV1), the document the RECOMPUTE_WEAKNESS job writes and TR-5 / the hub / Home read whole. Writers
// validate (`buildWeaknessMetrics` throws); readers are lenient (`parseWeaknessMetrics` returns null for a row an older
// or newer build wrote, and the caller treats the snapshot as missing and asks for a rebuild).
//
// The schema itself is defined once, in @repo/contracts/internal/weakness-metrics: the engine that produces the
// document (@repo/chess-training/weakness, which cannot import this package) takes its types from the same schema, so
// the stored shape and the engine's output type cannot drift. p06-json.test.ts parses real computeWeakness() output.
//
// Live fields are not stored (plan 6.3): status (derived), progress, updating, inBank, rating, weekPlan, matchable,
// slug, lesson, seenVersion and version are added at read time.
import { WeaknessMetricsV1 } from "@repo/contracts/internal/weakness-metrics";

export { WeaknessMetricsV1 };

/** The DB enum WeaknessStatus (M6). COMPUTING exists in the enum but is never written in v1 (plan 8.14). */
export const WEAKNESS_STATUSES_DB = ["INSUFFICIENT", "COMPUTING", "READY", "FAILED"] as const;
/** The statuses a snapshot row is written with. */
export const WEAKNESS_STATUSES_WRITTEN = ["INSUFFICIENT", "READY", "FAILED"] as const;

/** Writer side: validates and returns the document, throws a ZodError on any mismatch. */
export function buildWeaknessMetrics(doc: unknown): WeaknessMetricsV1 {
  return WeaknessMetricsV1.parse(doc);
}

/** Reader side: the document, or null for a row that is not a valid v1 document (treated as no snapshot). */
export function parseWeaknessMetrics(raw: unknown): WeaknessMetricsV1 | null {
  const r = WeaknessMetricsV1.safeParse(raw);
  return r.success ? r.data : null;
}
