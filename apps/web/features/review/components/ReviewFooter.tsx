"use client";

// Footers (plan §4.1 "ReviewFooter"; V3ReviewSummary .pfoot, V3iPhoneReview .pbar2):
//   side mode, pinned under the panel: First, Prev, Next, Last, ⋯ (moves); Previous Moment, primary, ⋯ (a moment);
//   stack mode, BoardStage's control bar: Prev, primary, Next, ⋯ (moves); Previous Moment, primary, ⋯ (a moment).
// `useReviewPrimary()` names the current primary once, for both bars and the Enter key: Start Review · N Moments,
// Done, Retry Analysis, the disabled "Analysing… 37%", Back to My Games or Report a Problem; in a moment Reveal the
// Answer while answering, then Next Moment, or Finish Review on the last one. Previous Moment on the first moment
// returns to the summary (labelled so), so the walkthrough is never a dead end.

import dynamic from "next/dynamic";
import Link from "next/link";
import { BUTTONS } from "../copy";
import { useReview, useView } from "../context";
import { progressOf } from "../model";
import { isAsking, MOMENT_COPY } from "../moments";
import { reviewCompletePath } from "../paths";
import { useMomentWalkthrough } from "../useMomentWalkthrough";
import { MenuButton } from "./MenuButton";

const ReviewMenu = dynamic(() => import("./ReviewMenu"), {
  loading: () => <MenuButton disabled />,
});

export type ReviewPrimary =
  | { kind: "button"; label: string; run: () => void; disabled?: boolean; testId: string }
  | { kind: "link"; label: string; href: string; testId: string };

export function useReviewPrimary(): ReviewPrimary {
  const { dto, phase, refId, actions, demo } = useReview();
  const walk = useMomentWalkthrough();
  const mode = useView((v) => v.mode);
  const momentIndex = useView((v) => v.momentIndex);
  const momentPhase = useView((v) => v.phase);
  const leaveMoments = useView((v) => v.leaveMoments);
  const complete = demo ? "#complete" : reviewCompletePath(refId);
  const moments = dto.review?.moments.length ?? 0;
  if (mode === "moment" && moments > 0) {
    if (isAsking(momentPhase)) return { kind: "button", label: MOMENT_COPY.reveal, run: walk.reveal, testId: "reveal-answer" };
    return momentIndex >= moments - 1
      ? { kind: "button", label: MOMENT_COPY.finish, run: () => void walk.finish(), testId: "finish-review" }
      : { kind: "button", label: MOMENT_COPY.nextMoment, run: walk.next, testId: "next-moment" };
  }
  if (mode === "moment") return { kind: "button", label: BUTTONS.done, run: leaveMoments, testId: "review-done" };
  switch (phase.kind) {
    case "loading":
    case "none":
    case "queued":
    case "running":
    case "writing": {
      const pct = phase.kind === "queued" || phase.kind === "none" ? 0 : progressOf(dto.analysis, phase.kind === "writing", phase.kind === "writing" ? phase.step : null).pct;
      return { kind: "button", label: `Analysing… ${pct}%`, run: () => undefined, disabled: true, testId: "primary-analysing" };
    }
    case "failed":
      return phase.retryable
        ? { kind: "button", label: BUTTONS.retry, run: actions.retry, disabled: actions.retrying, testId: "retry-analysis" }
        : { kind: "link", label: BUTTONS.reportProblem, href: demo ? "#help" : "/help#contact", testId: "report-problem" };
    case "skipped":
      return { kind: "link", label: BUTTONS.backToGames, href: demo ? "#games" : "/games", testId: "back-to-games" };
    case "done":
      if (phase.clean || phase.moments === 0) return { kind: "link", label: BUTTONS.done, href: complete, testId: "review-done" };
      return { kind: "button", label: BUTTONS.startReview(phase.moments), run: actions.startReview, testId: "start-review" };
  }
}

function PrimaryButton({ p, className = "rv-btn-p" }: { p: ReviewPrimary; className?: string }) {
  if (p.kind === "link") {
    return (
      <Link className={className} href={p.href} data-testid={`bar-${p.testId}`}>
        {p.label}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={p.run} disabled={p.disabled} data-testid={`bar-${p.testId}`}>
      {p.label}
    </button>
  );
}

function Chevron({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const ICON = {
  first: "M17 6l-6 6 6 6M7 6v12",
  prev: "M15 6l-6 6 6 6",
  next: "M9 6l6 6-6 6",
  last: "M7 6l6 6-6 6M17 6v12",
};

/** Ply navigation shared by both bars (−1 = the start position). */
export function usePlyNav() {
  const { lastPly } = useReview();
  const ply = useView((v) => v.ply);
  const setPly = useView((v) => v.setPly);
  return {
    atStart: ply <= -1,
    atEnd: ply >= lastPly,
    first: () => setPly(-1),
    prev: () => setPly(Math.max(-1, ply - 1)),
    next: () => setPly(Math.min(lastPly, ply + 1)),
    last: () => setPly(lastPly),
  };
}

/** The side panel's pinned footer. */
/** "Previous Moment", or "Back to the Summary" on the first moment. */
function prevMomentLabel(index: number): string {
  return index > 0 ? MOMENT_COPY.previousMoment : BUTTONS.backToSummary;
}

export function ReviewFooter() {
  const mode = useView((v) => v.mode);
  const momentIndex = useView((v) => v.momentIndex);
  const walk = useMomentWalkthrough();
  const nav = usePlyNav();
  const primary = useReviewPrimary();
  if (mode === "moment") {
    return (
      <div className="rv-foot" data-rv-side="" style={{ gridTemplateColumns: "48px minmax(0, 1fr) 44px" }} data-testid="review-footer">
        <button
          type="button"
          className="rv-ib"
          style={{ width: "auto", minHeight: 48 }}
          aria-label={prevMomentLabel(momentIndex)}
          title={prevMomentLabel(momentIndex)}
          onClick={walk.prev}
          data-testid="prev-moment"
        >
          <Chevron d={ICON.prev} />
        </button>
        <PrimaryButton p={primary} />
        <ReviewMenu />
      </div>
    );
  }
  return (
    <div className="rv-foot" data-rv-side="" data-testid="review-footer">
      <button type="button" className="rv-ib" aria-label={BUTTONS.first} title={BUTTONS.first} onClick={nav.first} disabled={nav.atStart} data-testid="nav-first">
        <Chevron d={ICON.first} />
      </button>
      <button type="button" className="rv-ib" aria-label={BUTTONS.prev} title={BUTTONS.prev} onClick={nav.prev} disabled={nav.atStart} data-testid="nav-prev">
        <Chevron d={ICON.prev} />
      </button>
      <button type="button" className="rv-ib" aria-label={BUTTONS.next} title={BUTTONS.next} onClick={nav.next} disabled={nav.atEnd} data-testid="nav-next">
        <Chevron d={ICON.next} />
      </button>
      <button type="button" className="rv-ib" aria-label={BUTTONS.last} title={BUTTONS.last} onClick={nav.last} disabled={nav.atEnd} data-testid="nav-last">
        <Chevron d={ICON.last} />
      </button>
      <ReviewMenu />
    </div>
  );
}

/** The phone / iPad-portrait control bar (BoardStage footer). */
export function ReviewActionBar() {
  const mode = useView((v) => v.mode);
  const momentIndex = useView((v) => v.momentIndex);
  const walk = useMomentWalkthrough();
  const nav = usePlyNav();
  const primary = useReviewPrimary();
  if (mode === "moment") {
    return (
      <div className="rv-abar" style={{ gridTemplateColumns: "44px minmax(0, 1fr) 44px" }} data-testid="review-action-bar">
        <button
          type="button"
          className="rv-ib"
          aria-label={prevMomentLabel(momentIndex)}
          onClick={walk.prev}
          data-testid="bar-prev-moment"
        >
          <Chevron d={ICON.prev} />
        </button>
        <PrimaryButton p={primary} />
        <ReviewMenu testId="review-menu-bar" />
      </div>
    );
  }
  return (
    <div className="rv-abar" data-testid="review-action-bar">
      <button type="button" className="rv-ib" aria-label={BUTTONS.prev} onClick={nav.prev} disabled={nav.atStart} data-testid="bar-prev">
        <Chevron d={ICON.prev} />
      </button>
      <PrimaryButton p={primary} />
      <button type="button" className="rv-ib" aria-label={BUTTONS.next} onClick={nav.next} disabled={nav.atEnd} data-testid="bar-next">
        <Chevron d={ICON.next} />
      </button>
      <ReviewMenu testId="review-menu-bar" />
    </div>
  );
}
