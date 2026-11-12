"use client";

// The status cards of the review panel (plan §4.1 "States and transitions"; V3ReviewAnalysing, V3ReviewFailed):
// analysing (queued / running / writing), failed (retryable, with the automatic retry countdown; terminal) and
// skipped. `role="status"` while analysing, `role="alert"` for a failure; numbers are computed from the payload.

import Link from "next/link";
import { useClientNow } from "../clock";
import { BUTTONS, COPY, engineLine, queuedLine, retryCountdownLine, runningLine } from "../copy";
import { useReview } from "../context";
import { failureLine, progressOf, secondsUntil, type ReviewPhase } from "../model";

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
    </svg>
  );
}

/** Analysing: queued, running or writing. The card takes focus after an optimistic Retry (plan §5.2). */
export function AnalysingCard({ phase }: { phase: Extract<ReviewPhase, { kind: "queued" | "running" | "writing" | "none" }> }) {
  const { dto } = useReview();
  const writing = phase.kind === "writing";
  const p = progressOf(dto.analysis, writing);
  const queued = phase.kind === "queued" || phase.kind === "none";
  const title = queued ? queuedLine(phase.kind === "queued" ? phase.etaSec : null) : writing ? COPY.writing : runningLine(p.movesDone, p.movesTotal);
  const a = dto.analysis;
  return (
    <div
      className="rv-section"
      role="status"
      aria-live="polite"
      tabIndex={-1}
      data-testid="analysing-card"
      data-substate={queued ? "queued" : writing ? "writing" : "running"}
      id="rv-progress"
    >
      <div className="rv-section__row">
        <span className="rv-spin" aria-hidden="true" />
        <span style={{ fontWeight: 500, minWidth: 0 }}>{title}</span>
        {queued ? null : (
          <span className="rv-mono" style={{ marginLeft: "auto" }}>
            {p.pct}%
          </span>
        )}
      </div>
      <div className="rv-bar" aria-hidden="true">
        <span style={{ width: `${queued ? 0 : p.pct}%` }} />
      </div>
      {a ? (
        <span className="rv-mono rv-soft" style={{ fontSize: "0.75rem" }}>
          {engineLine(a.engineLabel, a.depthLabel)}
        </span>
      ) : null}
      <p className="rv-p rv-tall">{COPY.stepThrough}</p>
    </div>
  );
}

/** Failed: retryable (Retry Analysis + What Happened? + the auto-retry countdown) or terminal (Report a Problem). */
export function FailedCard({ phase }: { phase: Extract<ReviewPhase, { kind: "failed" }> }) {
  const { dto, actions, demo } = useReview();
  // After hydration only (regression: failed-card-hydration: the server rendered N s, the client N ± 1).
  const now = useClientNow(phase.retryable && !!phase.retryAt);
  const left = phase.retryable && now !== null ? secondsUntil(phase.retryAt, now) : null;
  if (!phase.retryable) {
    return (
      <div className="rv-section" role="alert" data-testid="failed-card" data-substate="terminal">
        <div className="rv-note" data-tone="bad">
          <WarnIcon />
          <span>{COPY.terminal}</span>
        </div>
        <Link className="rv-btn-s" href={demo ? "#help" : "/help#contact"} data-rv-side="">
          {BUTTONS.reportProblem}
        </Link>
      </div>
    );
  }
  return (
    <div className="rv-section" role="alert" data-testid="failed-card" data-substate="retryable">
      <div className="rv-note" data-tone="bad">
        <WarnIcon />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong style={{ fontWeight: 500 }}>{COPY.failedTitle}</strong>
          <span>{failureLine(dto.game.startPly, dto.analysis?.totalPlies ?? 0, phase.failedAtPly)}</span>
          {left !== null ? (
            <span className="rv-soft" data-testid="retry-countdown">
              {retryCountdownLine(left)}
            </span>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }} data-rv-side="">
        <button
          type="button"
          className="rv-btn-p"
          style={{ flex: "1 1 auto" }}
          onClick={actions.retry}
          disabled={actions.retrying}
          data-testid="retry-analysis"
        >
          <RetryIcon />
          {BUTTONS.retry}
        </button>
        <Link className="rv-btn-s" href={demo ? "#how-we-grade" : "/how-we-grade#failures"}>
          {BUTTONS.whatHappened}
        </Link>
      </div>
      <Link className="rv-btn-s" href={demo ? "#how-we-grade" : "/how-we-grade#failures"} data-rv-stack="">
        {BUTTONS.whatHappened}
      </Link>
    </div>
  );
}

/** Skipped: fewer than 6 plies, or aborted. */
export function SkippedState() {
  const { demo } = useReview();
  return (
    <div className="rv-empty" data-testid="skipped-state">
      <p style={{ margin: 0, fontSize: "1rem" }}>{COPY.skipped}</p>
      <Link className="rv-btn-s" href={demo ? "#games" : "/games"} data-rv-side="" style={{ alignSelf: "flex-start" }}>
        {BUTTONS.backToGames}
      </Link>
    </div>
  );
}
