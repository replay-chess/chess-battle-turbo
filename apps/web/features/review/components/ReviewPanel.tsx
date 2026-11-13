"use client";

// The review panel: BoardStage's aside (plan §4.1 "Layout per device").
//   Side mode (desktop, iPad L): header (h2 "Review · vs tal_fan_77", meta "Rapid 10+0 · C59 Two Knights · 0–1
//   resigned"), Coach / Moves tabs (hidden while analysing, failed or in a moment), the scroll body with the "More
//   below" cue, and the pinned footer.
//   Stack mode (phones, iPad P): the 7-move strip, then the docked sheet (the only scroller) with the current-move
//   line and the same state content, minus the counts table, the phase line and the Moves tab.

import { useEffect, useRef, useState } from "react";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { BUTTONS, COPY, reviewMeta, reviewTitle } from "../copy";
import { useReview, useView } from "../context";
import { other } from "../model";
import { trackReview } from "../telemetry";
import { ReviewFooter } from "./ReviewFooter";
import { CurrentMoveLine, ReviewMoveList, ReviewMoveStrip } from "./ReviewMoveList";
import { AnalysingCard, FailedCard, SkippedState } from "./StatusCards";
import { SummaryPanel } from "./SummaryPanel";
// Eager, not next/dynamic: it renders on the server, and a lazy one was a streamed Suspense segment whose hidden server
// copy could outlive React's own render of it (duplicate test ids; features/game/screen/GameScreen.tsx).
import { KeyMomentStepper } from "./KeyMomentStepper";

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** The state card (analysing, failed, skipped), or null in the summary and in moments. */
function StateCard() {
  const { phase } = useReview();
  switch (phase.kind) {
    case "none":
    case "queued":
    case "running":
    case "writing":
      return <AnalysingCard phase={phase} />;
    case "failed":
      return <FailedCard phase={phase} />;
    case "skipped":
      return <SkippedState />;
    default:
      return null;
  }
}

function RefreshBanner() {
  const { actions } = useReview();
  if (!actions.refreshFailed) return null;
  return (
    <div style={{ padding: "10px 14px 0" }}>
      <Banner
        tone="warn"
        layout="note"
        data-testid="refresh-failed"
        action={
          <Button size="sm" variant="secondary" onClick={actions.refetch}>
            {BUTTONS.tryAgain}
          </Button>
        }
      >
        {COPY.refreshFailed}
      </Banner>
    </div>
  );
}

function useMoreCue(ref: React.RefObject<HTMLElement | null>, deps: unknown[]): boolean {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.clientHeight > 8 && el.scrollTop + el.clientHeight < el.scrollHeight - 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure when the content changes
  }, deps);
  return more;
}

export function ReviewPanel() {
  const { dto, phase } = useReview();
  const tab = useView((v) => v.tab);
  const setTab = useView((v) => v.setTab);
  const mode = useView((v) => v.mode);
  const bodyRef = useRef<HTMLDivElement>(null);
  const done = phase.kind === "done";
  const showTabs = done && mode === "moves";
  const coach = done && mode === "moves" && tab === "coach";
  const more = useMoreCue(bodyRef, [phase.kind, tab, mode, dto.analysis?.gradedPlies]);
  const opponent = dto.players[other(dto.you)].name;
  const pick = (t: "coach" | "moves") => {
    if (t === tab) return;
    setTab(t);
    trackReview("review_tab_switched", { tab: t });
  };

  return (
    <div className="rv-side" data-testid="review-panel" aria-label={COPY.panelLabel} role="region" data-state={phase.kind} data-mode={mode}>
      <TopBarTitle>
        <span className="rv-lbl" data-testid="review-topbar-title" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
          {reviewTitle(opponent)}
        </span>
      </TopBarTitle>

      {/* ── side mode ── */}
      <header className="rv-head" data-rv-side="">
        <h2 className="rv-h2" data-testid="review-title">
          {reviewTitle(opponent)}
        </h2>
        <span className="rv-lbl" data-testid="review-meta">
          {reviewMeta(dto.game.tc.label, dto.game.opening, dto.game.endLabel)}
        </span>
      </header>
      {showTabs ? (
        <div className="rv-tabs" role="tablist" aria-label={COPY.tabsLabel} data-rv-side="">
          <button
            type="button"
            role="tab"
            id="rv-tab-coach"
            className="rv-tab"
            aria-selected={tab === "coach"}
            aria-controls="rv-body"
            tabIndex={tab === "coach" ? 0 : -1}
            onClick={() => pick("coach")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                pick("moves");
                document.getElementById("rv-tab-moves")?.focus();
              }
            }}
            data-testid="tab-coach"
          >
            {BUTTONS.coachTab}
          </button>
          <button
            type="button"
            role="tab"
            id="rv-tab-moves"
            className="rv-tab"
            aria-selected={tab === "moves"}
            aria-controls="rv-body"
            tabIndex={tab === "moves" ? 0 : -1}
            onClick={() => pick("moves")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                pick("coach");
                document.getElementById("rv-tab-coach")?.focus();
              }
            }}
            data-testid="tab-moves"
          >
            {BUTTONS.movesTab}
          </button>
        </div>
      ) : null}
      {/* stack mode: the 7-move strip between the board and the sheet */}
      {mode === "moves" ? <ReviewMoveStrip /> : null}
      {/* The state card (analysing, failed, skipped) stays pinned above the scroller, so the progress and Retry are
          on screen while the move list keeps the current ply in view. */}
      {mode === "moves" ? (
        <div className="rv-pin">
          <StateCard />
        </div>
      ) : null}
      <div className="rv-pwrap">
        {/* One scroller for both modes: the panel body (side) or the docked sheet (stack). */}
        <div
          className="rv-body"
          ref={bodyRef}
          id="rv-body"
          role={showTabs ? "tabpanel" : "region"}
          aria-labelledby={showTabs ? (tab === "coach" ? "rv-tab-coach" : "rv-tab-moves") : undefined}
          aria-label={showTabs ? undefined : COPY.coachRegion}
          tabIndex={0}
          data-rv-scroll=""
          data-testid="review-body"
        >
          <div className="rv-grab" aria-hidden="true" data-rv-stack="" />
          <RefreshBanner />
          {mode === "moment" ? (
            <KeyMomentStepper />
          ) : (
            <>
              {done ? (
                <div data-rv-side-hide={tab === "coach" ? undefined : ""}>
                  <SummaryPanel />
                </div>
              ) : null}
              {!done || tab === "moves" ? (
                <div data-rv-side="">
                  <ReviewMoveList />
                </div>
              ) : null}
              <div data-rv-stack="" className="rv-stackline">
                <CurrentMoveLine sticky={false} />
              </div>
            </>
          )}
        </div>
        {more && (coach || mode === "moment") ? (
          <div className="rv-morecue" aria-hidden="true">
            <span>
              {COPY.moreBelow}
              <ChevronDown />
            </span>
          </div>
        ) : null}
      </div>
      <ReviewFooter />
    </div>
  );
}
