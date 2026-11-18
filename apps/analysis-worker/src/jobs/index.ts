// The job kinds this worker runs, one handler each (phase-03 plan §7.7). The scheduler claims only these kinds, so a
// kind without a handler simply waits in the queue for the build that has one.
import type { MistakesAddedCoalescer } from "../extract/coalesce";
import { analyzeGameHandler, type AnalyzeDeps } from "../pipeline/analyze-game";
import { extractMistakesHandler } from "./extract-mistakes";
import type { LegendCompareStore } from "../pipeline/store";
import { housekeepingHandler } from "./housekeeping";
import { importPurgeHandler } from "./import-purge";
import { importSyncHandler, type ImportDeps } from "./import-sync";
import { legendCompareHandler } from "./legend-compare";
import { weaknessRecomputeHandler } from "./weakness-recompute";
import { defaultImportSettings } from "../import/settings";
import type { HandlerMap } from "./runner";

export interface HandlerDeps extends AnalyzeDeps {
  store: AnalyzeDeps["store"] & LegendCompareStore;
  /** P4: the provider clients and import settings; without them the worker runs no import kind. */
  imports?: ImportDeps;
  /**
   * P5: the `mistakes:added` coalescer. With `bank.enabled` (BANK_EXTRACT_ENABLED) and a coalescer the worker runs
   * EXTRACT_MISTAKES; with the switch off J1 is skipped and the backfill rows wait in the queue.
   */
  mistakesAdded?: MistakesAddedCoalescer;
}

export function defaultHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ANALYZE_GAME: analyzeGameHandler(deps),
    LEGEND_COMPARE: legendCompareHandler({ store: deps.store }),
    HOUSEKEEPING: housekeepingHandler(undefined, undefined, deps.weakness ? { weakness: deps.weakness.settings } : {}),
    ...(deps.bank?.enabled && deps.mistakesAdded
      ? {
          EXTRACT_MISTAKES: extractMistakesHandler({
            settings: deps.bank,
            events: deps.events,
            coalescer: deps.mistakesAdded,
          }),
        }
      : {}),
    ...(deps.imports
      ? {
          IMPORT_SYNC: importSyncHandler({ ...deps.imports, events: deps.imports.events ?? deps.events }),
          IMPORT_PURGE: importPurgeHandler({
            events: deps.imports.events ?? deps.events,
            ...(deps.weakness ? { weakness: deps.weakness.settings } : {}),
          }),
        }
      : {}),
    // P6 (phase-06 plan §7.4.2): RECOMPUTE_WEAKNESS on the I/O lane. Registered whenever the weakness deps exist; with
    // WEAKNESS_JOBS_ENABLED off the handler ends each row DONE `skipped: "disabled"` (the kill switch).
    ...(deps.weakness
      ? {
          RECOMPUTE_WEAKNESS: weaknessRecomputeHandler({
            settings: deps.weakness.settings,
            paywall: (deps.imports?.settings ?? defaultImportSettings()).paywall,
            eager: {
              cap: (deps.imports?.settings ?? defaultImportSettings()).cap,
              eagerTrial: (deps.imports?.settings ?? defaultImportSettings()).eagerTrial,
            },
            events: deps.events,
            progress: deps.weakness.progress,
            ...(deps.weakness.baselineId ? { baselineId: deps.weakness.baselineId } : {}),
          }),
        }
      : {}),
  };
}

export type { HandlerMap } from "./runner";
export { JobAborted, JobError, throwIfAborted } from "./types";
export type { FailureHookInput, JobContext, JobHandler, JobOutcome } from "./types";
