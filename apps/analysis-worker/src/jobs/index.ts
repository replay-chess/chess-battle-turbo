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
    HOUSEKEEPING: housekeepingHandler(),
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
          IMPORT_PURGE: importPurgeHandler({ events: deps.imports.events ?? deps.events }),
        }
      : {}),
  };
}

export type { HandlerMap } from "./runner";
export { JobAborted, JobError, throwIfAborted } from "./types";
export type { FailureHookInput, JobContext, JobHandler, JobOutcome } from "./types";
