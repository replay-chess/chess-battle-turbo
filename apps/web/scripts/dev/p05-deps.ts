// The domain functions the P5 persona writer takes (packages/db/seed/p05-persona-states.ts `TrainingDeps`), loaded from
// their owners so persona rows are exactly what the worker and the routes write: the position hash from
// @repo/chess-analysis/epd (WP-C), the card key codec, the local day, the next release and card mastery from
// @repo/chess-training (WP-B). Loaded on demand: only a P5 reset needs them (handbacks/signatures.md §3 fixes the
// names and signatures).
//
// The specifiers are resolved at run time and every function is probed once with a known input before a reset uses
// it, so a missing module or a changed signature fails the reset with a clear message instead of writing rows that
// disagree with the worker's (a P5 reset never runs without the real functions).
import type { TrainingDeps } from "@repo/db/seed/p05-persona-states";

export const TRAINING_DEP_SOURCES = {
  epdHash: "@repo/chess-analysis/epd",
  mistakeItemKey: "@repo/chess-training/items",
  dayKey: "@repo/chess-training/day",
  nextRelease: "@repo/chess-training/release",
  masteryOf: "@repo/chess-training/mastery",
} as const satisfies Record<keyof TrainingDeps, string>;

type Loader = (specifier: string) => Promise<Record<string, unknown>>;

const nodeImport: Loader = async (specifier) => (await import(specifier)) as Record<string, unknown>;

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Probes each function with a known input; throws naming the module that does not keep its contract. */
export function checkTrainingDeps(deps: TrainingDeps): TrainingDeps {
  const fail = (name: keyof TrainingDeps, why: string) => {
    throw new Error(`[personas] ${TRAINING_DEP_SOURCES[name]} ${name}: ${why} (handbacks/signatures.md §3)`);
  };
  const h = deps.epdHash(START);
  if (typeof h !== "bigint" || h !== BigInt.asIntN(64, h)) fail("epdHash", "must return a signed 64-bit bigint");
  if (deps.epdHash(START.replace(" 0 1", " 5 9")) !== h) fail("epdHash", "must ignore the move counters (EPD = FEN fields 1–4)");
  const key = deps.mistakeItemKey(h);
  if (typeof key !== "string" || !/^m_[A-Za-z0-9]{1,24}$/.test(key)) fail("mistakeItemKey", `"${String(key)}" is not an m_ item key`);
  const now = new Date("2026-11-12T03:00:00.000Z");
  if (deps.dayKey(now, "UTC", 4) !== "2026-11-11") fail("dayKey", "03:00 UTC with the day starting at 04:00 is still 2026-11-11");
  const release = deps.nextRelease(now, "UTC", 8);
  if (!(release instanceof Date) || release.toISOString() !== "2026-11-12T08:00:00.000Z") fail("nextRelease", "must return the next local 08:00 as a Date");
  if (deps.masteryOf("NEW", 0) !== 0 || deps.masteryOf("REVIEW", 120) !== 5) fail("masteryOf", "NEW → 0 and REVIEW with stability ≥ 90 → 5 (plan 8.8)");
  return deps;
}

export async function loadTrainingDeps(load: Loader = nodeImport): Promise<TrainingDeps> {
  const fns = await Promise.all(
    (Object.entries(TRAINING_DEP_SOURCES) as [keyof TrainingDeps, string][]).map(async ([name, specifier]) => {
      let mod: Record<string, unknown>;
      try {
        mod = await load(specifier);
      } catch (err) {
        throw new Error(`[personas] cannot load ${specifier} for ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const fn = mod[name];
      if (typeof fn !== "function") throw new Error(`[personas] ${specifier} does not export ${name} (handbacks/signatures.md §3)`);
      return [name, fn] as const;
    }),
  );
  return checkTrainingDeps(Object.fromEntries(fns) as unknown as TrainingDeps);
}
