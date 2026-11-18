// Weakness settings of the worker (phase-06 plan §7.7, §7.10). Parsed once at boot by config/env.ts
// (`WorkerEnv.weakness`); a bad value refuses the boot with a message that names the variable, never its value.
//
// | Variable                    | Default                              | Notes                                            |
// |-----------------------------|--------------------------------------|--------------------------------------------------|
// | WEAKNESS_JOBS_ENABLED       | on (dev, test, local), off (production until P13) | kill switch: RECOMPUTE_WEAKNESS ends DONE `skipped: "disabled"`, the worker's own triggers no-op |
// | WEAKNESS_ANALYSE_CAP        | 100                                  | J4 in-scope analysis target per member (D-P6-3)  |
// | WEAKNESS_ANALYSE_CAP_TRIAL  | 20                                   | the same for a trialist (≤ the cap)              |
// | WEAKNESS_DEBOUNCE_SEC       | 240                                  | coalescing window; must stay below 300 (Neon's suspend) |
// | WEAKNESS_SEED_FREEZE        | off                                  | test hook (persona `weakcompute`): the worker's triggers leave a seeded far-future job alone; refused with APP_ENV=production |
// | WEAKNESS_HEAL_MAX_ROWS      | 40                                   | FIX-1: rows one RECOMPUTE_WEAKNESS heals (1..300); more → it heals these, re-queues itself and writes no snapshot yet, so one run stays inside the heal SLO (≤ 4 s) on the 1-OCPU worker |
// | WEAKNESS_LINES_BUDGET_MS    | 20000                                | FIX-3: the weakness-only engine searches of one analysis, regrade or lines refresh start no new search after this long (1000..120000); the rest is left to a `weakness_lines` refresh |
import { ANALYSE_CAP, ANALYSE_CAP_TRIAL } from "@repo/chess-training/weakness/constants";
import { WEAKNESS_DEBOUNCE_MAX_SEC, WEAKNESS_DEBOUNCE_SEC } from "@repo/db/weakness-jobs";
import { EnvError, type AppEnvName } from "../config/env";
import { HEAL_MAX_ROWS } from "./heal";
import { WEAKNESS_INPUTS_VERSION } from "./inputs";

export interface WeaknessSettings {
  /** WEAKNESS_JOBS_ENABLED. */
  enabled: boolean;
  /** WEAKNESS_ANALYSE_CAP: in-scope analysed games wanted per member (J4 target). */
  analyseCap: number;
  /** WEAKNESS_ANALYSE_CAP_TRIAL: the same for a trialist. */
  analyseCapTrial: number;
  /** WEAKNESS_DEBOUNCE_SEC (0..299). */
  debounceSec: number;
  /** WEAKNESS_SEED_FREEZE (dev/test only). */
  seedFreeze: boolean;
  /** WEAKNESS_HEAL_MAX_ROWS: rows healed per run (FIX-1); the rest in the next run. */
  healMaxRows: number;
  /** WEAKNESS_LINES_BUDGET_MS (FIX-3): the weakness-only searches of one job start no new search after this long. */
  linesBudgetMs: number;
  /**
   * FIX-3 (D-P6-FIX3-8): the inputs/tagger version this build writes (CA WEAKNESS_INPUTS_VERSION). A test of a later
   * build sets it to show a version bump retries rows an earlier version could not compute (once). Not an env var.
   */
  inputsVersion: number;
}

/** FIX-3 (D-P6-FIX3-9): WEAKNESS_LINES_BUDGET_MS's default: ≈ 40 pass-1 searches on the 1-OCPU dev worker. */
export const WEAKNESS_LINES_BUDGET_MS = 20_000;

type RawEnv = Readonly<Record<string, string | undefined>>;

function str(raw: RawEnv, name: string): string | null {
  const v = raw[name]?.trim();
  return v ? v : null;
}

function int(raw: RawEnv, name: string, min: number, max: number, fallback: number): number {
  const v = str(raw, name);
  if (v === null) return fallback;
  if (!/^\d+$/.test(v)) throw new EnvError(`${name} must be an integer`);
  const n = Number(v);
  if (n < min || n > max) throw new EnvError(`${name} must be within ${min}..${max}`);
  return n;
}

function onOff(raw: RawEnv, name: string, fallback: boolean): boolean {
  const v = str(raw, name)?.toLowerCase();
  if (v === undefined || v === null) return fallback;
  if (["on", "1", "true", "yes"].includes(v)) return true;
  if (["off", "0", "false", "no"].includes(v)) return false;
  throw new EnvError(`${name} must be on or off`);
}

export function parseWeaknessSettings(raw: RawEnv, appEnv: AppEnvName): WeaknessSettings {
  const seedFreeze = onOff(raw, "WEAKNESS_SEED_FREEZE", false);
  if (seedFreeze && appEnv === "production") {
    throw new EnvError("WEAKNESS_SEED_FREEZE is a test hook: it is refused with APP_ENV=production");
  }
  const analyseCap = int(raw, "WEAKNESS_ANALYSE_CAP", 1, 300, ANALYSE_CAP);
  const analyseCapTrial = int(raw, "WEAKNESS_ANALYSE_CAP_TRIAL", 1, 300, ANALYSE_CAP_TRIAL);
  if (analyseCapTrial > analyseCap) throw new EnvError("WEAKNESS_ANALYSE_CAP_TRIAL must not exceed WEAKNESS_ANALYSE_CAP");
  return {
    enabled: onOff(raw, "WEAKNESS_JOBS_ENABLED", appEnv !== "production"),
    analyseCap,
    analyseCapTrial,
    debounceSec: int(raw, "WEAKNESS_DEBOUNCE_SEC", 0, WEAKNESS_DEBOUNCE_MAX_SEC, WEAKNESS_DEBOUNCE_SEC),
    seedFreeze,
    healMaxRows: int(raw, "WEAKNESS_HEAL_MAX_ROWS", 1, 300, HEAL_MAX_ROWS),
    linesBudgetMs: int(raw, "WEAKNESS_LINES_BUDGET_MS", 1_000, 120_000, WEAKNESS_LINES_BUDGET_MS),
    inputsVersion: WEAKNESS_INPUTS_VERSION,
  };
}

/** The defaults of a test or local run, with overrides. */
export function defaultWeaknessSettings(over: Partial<WeaknessSettings> = {}): WeaknessSettings {
  return { ...parseWeaknessSettings({}, "test"), ...over };
}
