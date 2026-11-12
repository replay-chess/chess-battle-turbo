// The job kinds this worker runs, one handler each (phase-03 plan §7.7). The scheduler claims only these kinds, so a
// kind without a handler simply waits in the queue for the build that has one.
import { analyzeGameHandler, type AnalyzeDeps } from "../pipeline/analyze-game";
import type { LegendCompareStore } from "../pipeline/store";
import { housekeepingHandler } from "./housekeeping";
import { legendCompareHandler } from "./legend-compare";
import type { HandlerMap } from "./runner";

export interface HandlerDeps extends AnalyzeDeps {
  store: AnalyzeDeps["store"] & LegendCompareStore;
}

export function defaultHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ANALYZE_GAME: analyzeGameHandler(deps),
    LEGEND_COMPARE: legendCompareHandler({ store: deps.store }),
    HOUSEKEEPING: housekeepingHandler(),
  };
}

export type { HandlerMap } from "./runner";
export { JobAborted, JobError, throwIfAborted } from "./types";
export type { FailureHookInput, JobContext, JobHandler, JobOutcome } from "./types";
