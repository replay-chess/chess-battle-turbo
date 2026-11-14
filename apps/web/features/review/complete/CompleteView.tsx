// Review complete (phase-03 plan §4.2, §5.3; boards V3RvComplete `default`, V3RvCompleteClean `nothing`, the plan's
// `partial` and `noMoments`). A server component: no client queries, plain links; the only client code is the
// keyboard island (Enter = the primary, Esc = back to the review) and the moments list (P2's MiniBoard and the badge
// icons are client modules).
//
// Layout: desktop / iPad L = the board's two columns (eyebrow, serif h1, the lead, the stat tiles, the primary and the
// link rows on the left; the card "The moments" on the right, scrolling inside its own region when short). iPad P and
// phones = one column: the lead, a 3-up stat row, the link rows, the moments card (the only scroller) and the primary
// pinned at the bottom. The document never scrolls (lock mode).
//
// P5 (phase-05 plan §4.8; owner WP-H) lights up, when the view carries the bank fields (`train` on): the Mistake Bank
// line in the lead, the To Drill stat, the Drill These 3 Mistakes primary (Enter; never prefetched: it creates a
// session) or Back to Home when every moment was opted out, and the Added / Not added tags. Not rendered yet: Ask the
// Coach about This Game (P7).

import Link from "next/link";
import { ArrowRight, ChevronLeft, Crosshair, House, Play, RotateCcw, Share } from "lucide-react";
import type { ReviewCompleteView } from "@repo/contracts/http/review";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import {
  bestMonthLine,
  COMPLETE_COPY,
  completeLead,
  completePrimary,
  completeStateOf,
  completeTitle,
  firstOpenMomentNumber,
  statTiles,
} from "./copy";
import { CompleteKeys } from "./CompleteKeys";
import { DrillLink } from "./DrillLink";
import { CompleteMoments } from "./CompleteMoments";
import "./complete.css";

export interface CompleteLinks {
  playAgain: string;
  /** Null when `review-share` is off. */
  share: string | null;
  reviewAgain: string;
  games: string;
  review: string;
  /** `/review/<ref>?m=N` (1-based). */
  moment(n: number): string;
  /** P5: Back to Home (every moment opted out of the Mistake Bank). Default `/home`. */
  home?: string;
}

/**
 * A link row. A forward row ends in an arrow; a back row (`back`) has only its leading chevron, as the board's
 * "Back to home" row (V3RvComplete; FIX-1: it had both).
 */
function Row({
  href,
  icon,
  children,
  testId,
  prefetch,
  back = false,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  testId: string;
  prefetch?: boolean;
  back?: boolean;
}) {
  return (
    <Link className="rvc-row" href={href} prefetch={prefetch} data-testid={testId} data-back={back ? "" : undefined}>
      <span className="rvc-row__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="rvc-row__text">{children}</span>
      {back ? null : <ArrowRight className="rvc-row__go" aria-hidden="true" size={16} />}
    </Link>
  );
}

export function CompleteView({ view, links }: { view: ReviewCompleteView; links: CompleteLinks }) {
  const state = completeStateOf(view);
  const tiles = statTiles(view, state);
  const open = firstOpenMomentNumber(view.moments);
  const openCount = view.moments.filter((m) => m.result === null).length;
  const clean = state === "nothing";
  const monthLine = clean && view.bestThisMonth ? bestMonthLine(view.accuracy) : null;
  const primary = completePrimary(view, state, { playAgain: links.playAgain, home: links.home ?? "/home" });
  const PrimaryIcon = primary.kind === "drill" ? Crosshair : primary.kind === "home" ? House : Play;

  return (
    <div className="rvc" data-rc-lock="" data-testid="review-complete" data-state={state}>
      <CompleteKeys primaryHref={primary.href} backHref={links.review} drillMistakes={primary.kind === "drill" ? (view.added ?? 1) : null} />
      <div className="rvc__grid">
        <div className="rvc__left">
          <header className="rvc__lead">
            <span className="rvc-lbl" data-testid="complete-eyebrow">
              {view.header.eyebrow}
            </span>
            <h1 className="rvc-h1" data-testid="complete-title">
              {completeTitle(state)}
            </h1>
            <p className="rvc-leadp" data-testid="complete-lead">
              {completeLead(view, state)}
            </p>
          </header>

          <dl className="rvc__tiles" aria-label={COMPLETE_COPY.statsLabel} data-count={tiles.length} data-testid="complete-stats">
            {tiles.map((t) => (
              <div className="rvc-tile" key={t.id} data-testid={`stat-${t.id}`}>
                <dt className="rvc-lbl">{t.label}</dt>
                <dd className="rvc-tile__n">
                  {t.value === "✓" ? (
                    <>
                      <span aria-hidden="true">✓</span>
                      <span className="rvc-vh">Yes</span>
                    </>
                  ) : (
                    t.value
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="rvc__actions">
          <div className="rvc__primary">
            {primary.kind === "drill" ? (
              <DrillLink className="rvc-btn-p" href={primary.href} mistakes={view.added ?? 1}>
                <PrimaryIcon aria-hidden="true" size={16} />
                {primary.label}
              </DrillLink>
            ) : (
              <Link className="rvc-btn-p" href={primary.href} data-testid="complete-primary" data-kind={primary.kind}>
                <PrimaryIcon aria-hidden="true" size={16} />
                {primary.label}
              </Link>
            )}
          </div>

          <nav className="rvc__rows" aria-label="Next steps">
            {state === "partial" && open !== null ? (
              <Row href={links.moment(open)} icon={<ArrowRight size={18} />} testId="complete-finish-last" prefetch={false}>
                {COMPLETE_COPY.finishLast(openCount)}
              </Row>
            ) : null}
            {links.share && view.shareEnabled ? (
              <Row href={links.share} icon={<Share size={18} />} testId="complete-share">
                {COMPLETE_COPY.share}
              </Row>
            ) : null}
            {view.moments.length > 0 ? (
              <Row href={links.reviewAgain} icon={<RotateCcw size={18} />} testId="complete-review-again" prefetch={false}>
                {COMPLETE_COPY.reviewAgain}
              </Row>
            ) : null}
            <Row href={links.games} icon={<ChevronLeft size={18} />} testId="complete-games" back>
              {COMPLETE_COPY.backToGames}
            </Row>
          </nav>
          </div>
        </div>

        <section className="rvc__card" aria-labelledby="rvc-moments-h" data-testid="complete-moments">
          <h2 className="rvc-lbl rvc__cardh" id="rvc-moments-h">
            {clean || state === "noMoments" ? COMPLETE_COPY.standoutsHeading : COMPLETE_COPY.momentsHeading}
          </h2>
          <ScrollRegion label={clean || state === "noMoments" ? COMPLETE_COPY.standoutsHeading : COMPLETE_COPY.momentsHeading} className="rvc__list">
            <CompleteMoments
              moments={view.moments}
              standouts={view.standouts}
              momentHrefs={view.moments.map((_, i) => links.moment(i + 1))}
              footnote={monthLine ?? (view.moments.length === 0 && view.standouts.length === 0 ? COMPLETE_COPY.noMomentsLead : null)}
              footnoteId={monthLine ? "complete-best-month" : "complete-footnote"}
            />
          </ScrollRegion>
        </section>
      </div>
    </div>
  );
}
