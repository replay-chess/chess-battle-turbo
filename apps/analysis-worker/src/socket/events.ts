// Typed builders for the worker's user-room events (CT/socket/analysis.ts; phase-03 plan §5.11). Each builder adds
// `v: 1` and parses with the contract schema, so a payload the socket server would refuse (422) fails here, in the
// worker's own logs and tests, instead of silently on the wire.
import {
  ANALYSIS_EVENTS,
  type AnalysisEventName,
  type AnalysisEventPayload,
  type AnalysisFailedEvent,
} from "@repo/contracts/socket/analysis";

type WithoutV<T> = T extends unknown ? Omit<T, "v"> : never;

/** Builds and validates one event payload. Throws a ZodError when the payload breaks the contract. */
export function buildEvent<N extends AnalysisEventName>(
  event: N,
  data: WithoutV<AnalysisEventPayload<N>>,
): AnalysisEventPayload<N> {
  return ANALYSIS_EVENTS[event].parse({ v: 1, ...data }) as AnalysisEventPayload<N>;
}

export function analysisFailedEvent(data: WithoutV<AnalysisFailedEvent>): AnalysisFailedEvent {
  return buildEvent("analysis:failed", data);
}
