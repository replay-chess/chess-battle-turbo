"use client";

// Client Sentry instrumentation of the P3 screens (phase-03 plan §10.2 "Client"; FIX-1). No names, no refs, no moves:
//
// - breadcrumbs for `analysis:*` events: the event type and its ply only (lib/realtime/handlers/analysis.ts calls
//   `analysisBreadcrumb` for every frame it applies, so the review, the game-over card and Compare all leave a trail);
// - the span `review.auto_advance` from `analysis:done` to the first paint of the summary (`AutoAdvanceSpan`);
// - the anonymous metric `review.first_badge_render_ms{device_class, source}` (owner decision B11 / P11: no consent
//   needed, nothing personal), the client half of the "game end → first badge" SLO (§9.1): `live` = from the first
//   `analysis:progress` frame that grades a ply to the paint that shows its badge; `load` = from the navigation start
//   to the first paint of a review that already had badges;
// - `captureBoundaryError` for the screens' error boundaries, with the request id of an ApiError as a tag.
import { withSentry } from "@/lib/sentry/lazy";
import { ApiError } from "@/lib/api/errors";
import { deviceClass } from "@/lib/shell/device-class";

export const FIRST_BADGE_METRIC = "review.first_badge_render_ms";
export const AUTO_ADVANCE_SPAN = "review.auto_advance";

/** The ply a frame is about (type and ply only, plan §10.2). */
export function analysisEventPly(payload: unknown): number | null {
  const p = payload as { gradedPlies?: unknown; failedAtPly?: unknown } | null;
  const ply = typeof p?.failedAtPly === "number" ? p.failedAtPly : typeof p?.gradedPlies === "number" ? p.gradedPlies : null;
  return ply;
}

/** One breadcrumb per applied `analysis:*` frame. */
export function analysisBreadcrumb(event: string, payload: unknown): void {
  const data = { ply: analysisEventPly(payload) };
  withSentry((Sentry) => Sentry.addBreadcrumb({ category: "analysis", type: "default", level: "info", message: event, data }));
}

/** Runs `fn` after the next paint (two animation frames: the frame that renders, then the one after it is shown). */
export function afterPaint(fn: () => void): () => void {
  let second = 0;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(fn);
  });
  return () => {
    cancelAnimationFrame(first);
    cancelAnimationFrame(second);
  };
}

/** Records the first-badge metric once (the caller keeps the once-per-mount guard). */
export function recordFirstBadge(ms: number, source: "live" | "load"): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const attributes = { device_class: deviceClass(), source };
  withSentry((Sentry) => Sentry.metrics.distribution(FIRST_BADGE_METRIC, Math.round(ms), { unit: "millisecond", attributes }));
}

/**
 * The auto-advance span: started on `analysis:done`, ended by `end()` at the summary's first paint. The SDK loads after
 * start-up (lib/sentry/lazy.ts): when it arrives only after `end()`, no span is recorded (it would have no start).
 */
export function startAutoAdvanceSpan(): { end: () => void } {
  let span: { end: () => void } | null = null;
  let ended = false;
  withSentry((Sentry) => {
    if (!ended) span = Sentry.startInactiveSpan({ name: AUTO_ADVANCE_SPAN, op: "ui.render", forceTransaction: true });
  });
  return {
    end: () => {
      ended = true;
      try {
        span?.end();
      } catch {
        // Telemetry never breaks the screen.
      }
    },
  };
}

/** A screen's error boundary: one Sentry event, tagged with the screen and the API request id when there is one. */
export function captureBoundaryError(error: unknown, screen: "review" | "games" | "compare"): string | null {
  const requestId = error instanceof ApiError ? (error.requestId ?? null) : null;
  const tags = { screen, ...(requestId ? { request_id: requestId } : {}), ...(error instanceof ApiError ? { api_code: error.code } : {}) };
  withSentry((Sentry) => Sentry.captureException(error, { tags }));
  return requestId;
}
