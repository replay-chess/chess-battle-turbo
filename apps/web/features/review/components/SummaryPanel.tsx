"use client";

// The summary (plan §4.1 `summary.coach`, `summary.noMoments`, `clean`; V3ReviewSummary, V3ReviewClean): the coach
// card with narration, the primary (Start Review · N Moments, or Done / See Your Best Move), the eval graph, the
// label counts and the phase line. Stack mode (phones, iPad portrait) shows the accuracy line and the opening first,
// drops the counts table and the phase line (rct-a §3; the counts stay on Complete), and moves the primary to the
// action bar.

import Link from "next/link";
import { CLEAN_LOSS_LINE } from "@repo/chess-analysis/text/clean";
import { reviewCompletePath } from "../paths";
import { accuracyLine, BUTTONS, COPY, reviewMeta } from "../copy";
import { useReview, useView } from "../context";
import { other, viewerLost } from "../model";
import { CoachLine } from "./CoachLine";
import { EvalGraph } from "./EvalGraph";
// Eager, not next/dynamic: it renders on the server, and a lazy one was a streamed Suspense segment whose hidden server
// copy could outlive React's own render of it (duplicate test ids; features/game/screen/GameScreen.tsx).
import LabelCountsTable from "./LabelCountsTable";

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** The clean-game line: congratulation and the best decision, or the clean-loss template (no congratulation). */
export function cleanText(lost: boolean, bestDecision: string | null): string {
  if (lost) return `${COPY.cleanLead} ${CLEAN_LOSS_LINE}`;
  return bestDecision ? `${COPY.cleanLead} ${bestDecision}` : COPY.cleanLead;
}

export function SummaryPanel() {
  const { dto, refId, actions, demo } = useReview();
  const setTab = useView((v) => v.setTab);
  const setPly = useView((v) => v.setPly);
  const review = dto.review;
  const a = dto.analysis;
  const moments = review?.moments.length ?? 0;
  const clean = review?.isClean ?? false;
  const completeHref = demo ? "#complete" : reviewCompletePath(refId);
  const acc = accuracyLine(a?.accuracy[dto.you] ?? null, a?.accuracy[other(dto.you)] ?? null, "done");

  return (
    <div className="rv-section" data-plain="" data-testid="review-summary" data-clean={clean ? "" : undefined}>
      <div className="rv-sheet__acc" data-rv-stack="">
        {acc ? <span className="rv-mono" style={{ fontSize: 12, fontWeight: 500 }}>{acc}</span> : <span />}
        <span className="rv-lbl">{reviewMeta(dto.game.tc.label, dto.game.opening, dto.game.endLabel)}</span>
      </div>

      {review && review.summary.length > 0 ? (
        <CoachLine sentences={review.summary} textStatus={review.textStatus} context="summary" />
      ) : null}

      {clean && review ? (
        <>
          <div className="rv-note" data-tone="good" data-testid="clean-note">
            <CheckIcon />
            <span>{cleanText(viewerLost(dto), review.bestDecision)}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }} data-rv-side="">
            {review.bestPly !== null ? (
              <button
                type="button"
                className="rv-btn-p"
                style={{ flex: "1 1 auto" }}
                onClick={() => {
                  setPly(review.bestPly!);
                  setTab("moves");
                }}
                data-testid="see-best-move"
              >
                {BUTTONS.seeBestMove}
              </button>
            ) : null}
            <Link className="rv-btn-s" href={completeHref} data-testid="review-done">
              {BUTTONS.done}
            </Link>
          </div>
        </>
      ) : moments > 0 ? (
        <button type="button" className="rv-btn-p" onClick={actions.startReview} data-rv-side="" data-testid="start-review">
          {BUTTONS.startReview(moments)}
        </button>
      ) : (
        <>
          <div className="rv-note" data-testid="no-moments">
            <span>{COPY.noMoments}</span>
          </div>
          <Link className="rv-btn-s" href={completeHref} data-rv-side="" style={{ alignSelf: "flex-start" }} data-testid="review-done">
            {BUTTONS.done}
          </Link>
        </>
      )}

      <EvalGraph />

      {a ? (
        <div data-rv-side="">
          <LabelCountsTable counts={a.counts} you={dto.you} />
        </div>
      ) : null}
      {review?.phaseLine ? (
        <p className="rv-phase rv-tall" data-rv-side="">
          {review.phaseLine}
        </p>
      ) : null}
    </div>
  );
}
