// Grading version and engine profile (phase-03 plan §8.13, §8.14, P3-D9).
//
// - `GRADING_VERSION` is the classifier version stored in `game_analyses.version`. A classifier-only change
//   (thresholds, label rules, templates) bumps it, and the worker re-grades from the stored `evals`, `second`,
//   `best` and `lines` with no engine work (P3-D28).
// - `ENGINE_PROFILE` fixes what the engine is asked to do. Changing any of its numbers needs a full re-run of the
//   engine, so a profile change gets a new `id` and the goldens are regenerated.
//
// Freeze status (2026-11-11, stage A of phase 3): `sf18-v1` is frozen PROVISIONALLY with the plan's default budget
// (pass 1 = 120k nodes MultiPV 2). The acceptance bench of task C1 (`stockfish bench` and a 60-ply sample on the dev
// VM at 0.75 core, gate ≥ 60 games/hour) runs in stage B. If it fails, pass 1 drops to 80k nodes before any golden
// file is recorded; GRADING_VERSION stays 1 either way because nothing has been graded for users yet.

export const GRADING_VERSION = 1;

/** The day GRADING_VERSION 1 took effect (the provisional freeze above). */
export const GRADING_CHANGED_AT = "2026-11-11";

export const ENGINE_PROFILE = {
  id: "sf18-v1",
  engine: "Stockfish 18",
  threads: 1,
  hashMb: 64,
  /** Every position: the best move, its score and the MultiPV-2 score (`second`, P3-D28). */
  pass1: { nodes: 120_000, multipv: 2 },
  /** Key-moment, brilliant and legend-divergence candidates only. */
  pass2: { nodes: 1_000_000, multipv: 3, maxPositions: 6, maxSeconds: 60 },
  /** Games shorter than this are SKIPPED. */
  minPlies: 6,
  /** BOOK is only given before this ply offset (§8.4 rule 2). */
  bookMaxPly: 30,
} as const;

export type EngineProfile = typeof ENGINE_PROFILE;

/** `game_analyses.engine` is varchar(48): "<engine build id>/<profile id>". */
export const ENGINE_COLUMN_MAX = 48;

/**
 * The `game_analyses.engine` value for an engine build, e.g. `analysisEngine("sf18-armv8dp-1a2b3c4d")` →
 * "sf18-armv8dp-1a2b3c4d/sf18-v1". Throws if the result would not fit the column.
 */
export function analysisEngine(buildId: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(buildId))
    throw new RangeError(`invalid engine build id ${JSON.stringify(buildId)}`);
  const value = `${buildId}/${ENGINE_PROFILE.id}`;
  if (value.length > ENGINE_COLUMN_MAX) throw new RangeError(`engine id longer than ${ENGINE_COLUMN_MAX}: ${value}`);
  return value;
}

/** The profile id of a stored `engine` value ("…/sf18-v1" → "sf18-v1"); `null` when it has none. */
export function profileOf(engine: string): string | null {
  const i = engine.lastIndexOf("/");
  return i < 0 || i === engine.length - 1 ? null : engine.slice(i + 1);
}

/**
 * How an existing analysis relates to the current code (§8.12 step 3, §8.14):
 * - `current`: same profile and same GRADING_VERSION;
 * - `regrade`: same profile, older classifier: re-grade from the stored arrays, no engine work;
 * - `rerun`: another profile (or no profile recorded): the engine runs again from ply 0.
 */
export function analysisFreshness(stored: { version: number; engine: string }): "current" | "regrade" | "rerun" {
  if (profileOf(stored.engine) !== ENGINE_PROFILE.id) return "rerun";
  return stored.version === GRADING_VERSION ? "current" : "regrade";
}
