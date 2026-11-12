"use client";

// Compare with the legend `/review/[ref]/legend` (phase-03 plan §4.6, §5.7; DR/V3LegendCompare + the merged
// V3TryCompare stepper). The client root: BoardStage with the opponent chip, the board and your chip; the aside with
// the eyebrow, "You vs Morphy", the summary line, the two-line stepper (‹ Move 12. Ba4 · your line ›, Your Line /
// Morphy's Line), the four tabs and their panel (the only scroller), and the footer (Practice from Here, Share).
// Phones and iPad portrait: the opponent chip, the full-width board, the stepper and tabs over the docked sheet, and
// the bottom action bar.
//
// The board: the position before the split with both arrows (yours grey, the legend's sky) by default; the active
// line's position while stepping (←/→ along it, ↑/↓ to its ends, a table move jumps there); the narration's board
// while the Explanation tab plays its authored cues. URL: `?tab=` and `?ply=` (the position index on the tab's line),
// mirrored with replaceState. Data: useCompareData (A9 seeded, the one A9b, compare:ready, the A2 fallback).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { StaticExplanation } from "@repo/contracts/http/legend";
import type { PlayerCard } from "@repo/contracts/http/review";
import { Board } from "@/components/board/Board";
import type { Sq } from "@/components/board/types";
import { BoardStage } from "@/components/layout/BoardStage";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReviewShortcuts } from "@/features/review/keys/useReviewShortcuts";
import { QUALITY_LABEL } from "@/features/review/copy";
import { reviewSharePath } from "@/features/review/paths";
import { trackReview } from "@/features/review/telemetry";
import { legendExplanationQuery } from "@/lib/api/queries/review";
import { cn } from "@/lib/utils";
import { LineTable } from "./CompareTables";
import { ExplanationView } from "./ExplanationView";
import { explanationBoardAt } from "./explanation";
import { COMPARE_SHORTCUTS, compareKeyFor } from "./keys";
import {
  APOS,
  clampPos,
  compareBoard,
  compareLines,
  COMPARE_TABS,
  engineTerms,
  initialView,
  lastPos,
  legendMovesLead,
  lineForTab,
  openedFrom,
  practiceHref,
  practiceLead,
  yourMovesLead,
  type CompareTab,
  type CompareView,
  type LineKey,
} from "./model";
import { useCompareData, type CompareDemo } from "./useCompareData";
import { useNarrationPlayer } from "./useNarrationPlayer";
import { useScreenKeys } from "./useScreenKeys";
import "./compare.css";

function warmEngine(): void {
  void import("@/features/engine/prefetch").then(
    (m) => m.prefetchEngine(),
    () => undefined,
  );
}

const lazyEngineIntent = { onPointerEnter: warmEngine, onFocus: warmEngine, onTouchStart: warmEngine };

const NO_DESTS = (): Sq[] => [];
const NO_MOVE = (): void => undefined;

const TAB_LABEL = (tab: CompareTab, name: string): string =>
  tab === "explanation" ? "Explanation" : tab === "your_moves" ? "Your Moves" : tab === "legend_moves" ? `${name}${APOS}s Moves` : "Practice";

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

function PlayerChip({ card, side }: { card: PlayerCard; side: "w" | "b" }) {
  const colour = side === "w" ? "White" : "Black";
  return (
    <div className="lc-chip" data-testid={card.isYou ? "compare-chip-you" : "compare-chip-opponent"}>
      <span className="lc-chip__av" data-ink={card.kind === "bot" ? "" : undefined} aria-hidden="true">
        {card.initials}
      </span>
      <span className="lc-chip__nm">
        <span>
          {card.name}{" "}
          {card.rating !== null ? (
            <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem" }}>
              {card.kind === "bot" ? "≈" : ""}
              {card.rating}
            </span>
          ) : null}
        </span>
        <span className="lc-mono lc-soft" style={{ fontSize: "0.75rem" }}>
          {colour}
          {card.isYou ? " · you" : ""}
        </span>
      </span>
      <span className="lc-chip__clk" aria-hidden="true">
        —
      </span>
    </div>
  );
}

export interface CompareScreenProps {
  refId: string;
  initial: { tab?: string | null; ply?: string | null };
  /** `?from=` of the link (legend_compare_opened). */
  from?: string | null;
  flags: { share: boolean };
  /** Demo route only: no server (A9b replaced), a forced loading state and audio failure. */
  demo?: CompareDemo & { loading?: boolean; audioFailed?: boolean };
}

export function CompareScreen({ refId, initial, from = null, flags, demo }: CompareScreenProps) {
  const data = useCompareData(refId, demo);
  const { dto } = data;
  const lines = compareLines(dto);
  const [view, setView] = useState<CompareView>(() => initialView(dto, lines, initial));
  const explanationQuery = useQuery({
    ...legendExplanationQuery(refId),
    enabled: view.tab === "explanation" && dto.hasExplanation,
  });
  const explanation: StaticExplanation | null = explanationQuery.data?.explanation ?? null;
  const audioUrl = explanationQuery.data?.audioUrl ?? dto.audioUrl;
  const player = useNarrationPlayer(explanation, explanation ? audioUrl : null, demo?.audioFailed ?? false);
  const loading = demo?.loading ?? false;

  useReviewShortcuts("compare", COMPARE_SHORTCUTS);

  // ── URL mirror (`?tab`, `?ply`); replaceState with a null state so Next's router does not treat it as its own ──
  useEffect(() => {
    if (demo) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", view.tab);
      url.searchParams.set("ply", String(view.pos));
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    } catch {
      // A sandboxed history (rare) keeps the URL as it was.
    }
  }, [demo, view.tab, view.pos]);

  // ── telemetry: opened once, every tab view ──
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    let refPath: string | null = null;
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.origin === window.location.origin) refPath = `${r.pathname}${r.search}`;
    } catch {
      refPath = null;
    }
    trackReview("legend_compare_opened", { from: openedFrom(from, refPath), status: dto.status });
  }, [from, dto.status]);
  const viewedTab = useRef<CompareTab | null>(null);
  useEffect(() => {
    if (viewedTab.current === view.tab) return;
    viewedTab.current = view.tab;
    trackReview("compare_tab_viewed", { tab: view.tab, comparison_status: dto.status });
  }, [view.tab, dto.status]);

  // Leaving the Explanation tab stops the narration and gives the board back to the line.
  const pickTab = (tab: CompareTab) => {
    if (tab === view.tab) return;
    if (tab !== "explanation") player.disengage();
    setView((v) => {
      const line = lineForTab(tab, v.line);
      return { tab, line, pos: clampPos(lines, line, v.pos) };
    });
  };
  const step = (line: LineKey, pos: number) => {
    player.disengage();
    setView((v) => ({ ...v, line, pos: clampPos(lines, line, pos) }));
  };

  useScreenKeys((e, ctx) => {
    const key = compareKeyFor(e, ctx);
    if (!key) return false;
    if (typeof key === "object") {
      pickTab(key.tab);
      return true;
    }
    switch (key) {
      case "prev":
        if (view.pos <= 0) return false;
        step(view.line, view.pos - 1);
        return true;
      case "next":
        if (view.pos >= lastPos(lines, view.line)) return false;
        step(view.line, view.pos + 1);
        return true;
      case "first":
        step(view.line, 0);
        return true;
      case "last":
        step(view.line, lastPos(lines, view.line));
        return true;
      case "narration":
        if (view.tab !== "explanation" || !explanation || !audioUrl || player.failed) return false;
        player.toggle();
        return true;
    }
  });

  // ── the board ──
  const lineBoard = compareBoard(dto, lines, view);
  const narrating = view.tab === "explanation" && player.engaged && explanation !== null;
  const nb = narrating ? explanationBoardAt(explanation, player.manual ? { segment: player.segment } : { t: player.time }) : null;
  const board = nb
    ? {
        fen: nb.fen,
        last: nb.last,
        check: null,
        arrows: nb.arrows,
        highlights: nb.highlights,
        badges: nb.badges.map((b) => ({ sq: b.sq, kind: b.kind, label: QUALITY_LABEL[b.kind] })),
        label: `Narration board, part ${player.segment + 1} of ${explanation?.segments.length ?? 0}.`,
      }
    : { ...lineBoard, highlights: {}, badges: [] };

  const name = dto.legend.name;
  const opp = dto.you === "w" ? "b" : "w";
  const lineName = view.line === "yours" ? "Your line" : `${name}${APOS}s line`;
  const practice = practiceLead(dto);
  const hereHref = (() => {
    // Practice from Here: the board's position when it is a position of the game (your line, before its last move),
    // else the split.
    if (view.line === "yours" && !nb) {
      const ply = Math.min(view.pos, Math.max(0, lines.yours.length - 2));
      return `/practice?game=${encodeURIComponent(refId)}&ply=${ply}&from=compare`;
    }
    return practiceHref(dto);
  })();
  const errorBanner = dto.status === "failed" || data.loadFailed;
  // Practice from Here warms the engine on intent (P2's prefetch); the helper loads on the first intent, so the
  // compare page's first load carries none of the engine's file names (plan §9.6: no engine on /review/*).
  const intent = demo ? {} : lazyEngineIntent;

  const footerActions = (bar: boolean) => (
    <>
      <Link
        href={hereHref}
        prefetch={false}
        className={cn(buttonVariants({ variant: "primary" }), bar ? "min-h-12 min-w-0 flex-1" : "")}
        data-testid={bar ? "compare-bar-practice" : "compare-practice-here"}
        {...intent}
      >
        {/* min-w-0 + truncate: on a ~260 px phone bar (150 % zoom) the label shrinks instead of pushing Share off
            screen (regression: compare-bar-overflow). */}
        <span className="min-w-0 truncate">Practice from Here</span>
      </Link>
      {flags.share ? (
        <Link href={reviewSharePath(refId)} prefetch={false} className={cn(buttonVariants({ variant: "secondary" }), bar ? "min-h-12" : "")} data-testid={bar ? "compare-bar-share" : "compare-share"}>
          <ShareIcon />
          Share
        </Link>
      ) : null}
    </>
  );

  const panel = (() => {
    if (loading) {
      return (
        <div className="flex flex-col gap-2.5" aria-busy="true" data-testid="compare-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[70%]" />
          <Skeleton className="h-44 w-full" />
        </div>
      );
    }
    switch (view.tab) {
      case "explanation":
        return (
          <ExplanationView dto={dto} explanation={explanation} explanationLoading={explanationQuery.isPending} player={player} computing={data.computing} />
        );
      case "your_moves":
        return (
          <div className="flex flex-col gap-2.5">
            <p className="lc-p" data-testid="compare-your-lead">
              {yourMovesLead(dto)}
            </p>
            <LineTable
              rows={dto.yourLine.rows}
              line="yours"
              startPly={dto.startPly}
              divergencePly={dto.divergence?.ply ?? null}
              legendName={name}
              legendSide={dto.you}
              activeLine={view.line}
              activePos={view.pos}
              onPick={step}
            />
          </div>
        );
      case "legend_moves":
        return (
          <div className="flex flex-col gap-2.5">
            <p className="lc-p" data-testid="compare-legend-lead">
              {legendMovesLead(dto)}
            </p>
            <LineTable
              rows={dto.legendLine.rows}
              line="legend"
              startPly={dto.startPly}
              divergencePly={dto.divergence?.ply ?? null}
              legendName={name}
              legendSide={dto.you}
              activeLine={view.line}
              activePos={view.pos}
              onPick={step}
            />
          </div>
        );
      case "practice":
        return (
          <div className="flex flex-col items-start gap-2.5" data-testid="compare-practice">
            <p className="lc-p">{practice.lead}</p>
            <Link href={practiceHref(dto)} prefetch={false} className={buttonVariants({ variant: "primary" })} data-testid="compare-practice-from" {...intent}>
              Practice from Move {practice.moveNo}
            </Link>
            <span className="lc-soft" style={{ fontSize: "0.875rem" }}>
              {engineTerms(dto.practice.botElo)}
            </span>
          </div>
        );
    }
  })();

  return (
    <div
      data-rc-compare=""
      style={{ display: "contents" }}
      data-testid="compare-screen"
      data-status={dto.status}
      data-tab={view.tab}
      data-line={view.line}
      data-pos={view.pos}
    >
      {explanation && audioUrl ? (
        // preload="none": nothing downloads until Play (plan §5.7).
        <audio
          ref={player.audioRef}
          src={audioUrl}
          preload="none"
          onError={player.audioEvents.onError}
          onEnded={player.audioEvents.onEnded}
          onLoadedMetadata={player.audioEvents.onLoadedMetadata}
          data-testid="compare-audio"
          hidden
        />
      ) : null}
      <BoardStage
        label="Board"
        top={<PlayerChip card={dto.players[opp]} side={opp} />}
        bottom={<PlayerChip card={dto.players[dto.you]} side={dto.you} />}
        board={
          <div className="relative size-full" data-testid="compare-board" data-split={!nb && lineBoard.atSplit ? "" : undefined} data-narrating={nb ? "" : undefined}>
            <Board
              fen={board.fen}
              orientation={dto.you}
              mover={null}
              dests={NO_DESTS}
              onMove={NO_MOVE}
              lastMove={board.last}
              check={board.check}
              arrows={board.arrows}
              highlights={board.highlights}
              badges={board.badges}
              dimmed={loading}
              label={board.label}
              animationMs={120}
            />
          </div>
        }
        aside={
          <div className="lc-side" role="region" aria-label={`Compare with ${name}`} data-testid="compare-panel">
            <TopBarTitle>
              <span className="lc-lbl" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                You vs {name}
              </span>
            </TopBarTitle>
            <header className="lc-head">
              <span className="lc-lbl lc-sky" data-rc-side-only="">
                Compare with the legend
              </span>
              <h1 className="lc-h1" data-rc-side-only="" data-testid="compare-title">
                You vs {name}
              </h1>
              <span className="lc-soft lc-short-hide" data-testid="compare-summary">
                {dto.summaryLine}
              </span>
            </header>
            {errorBanner ? (
              <div style={{ padding: "0 16px 10px" }}>
                <Banner
                  tone="bad"
                  layout="note"
                  data-testid="compare-error"
                  action={
                    data.canTryAgain ? (
                      <Button size="sm" variant="secondary" onClick={data.tryAgain} data-testid="compare-try-again">
                        Try Again
                      </Button>
                    ) : undefined
                  }
                >
                  Couldn{APOS}t load the comparison.
                </Banner>
              </div>
            ) : null}
            <div className="lc-step" data-testid="compare-stepper">
              <button type="button" className="lc-ib" aria-label="Previous move" onClick={() => step(view.line, view.pos - 1)} disabled={view.pos <= 0}>
                <Chevron dir="left" />
              </button>
              <span className="lc-step__label" aria-live="polite">
                <span className="lc-mono" data-testid="compare-pos-label">
                  {nb ? `Narration · part ${player.segment + 1}` : lineBoard.posLabel}
                </span>
                <span className={cn("lc-mono", view.line === "legend" ? "lc-sky" : "lc-soft")} style={{ fontSize: "0.75rem" }}>
                  {!nb && lineBoard.atSplit ? "Paths split here" : lineName}
                </span>
              </span>
              <button type="button" className="lc-ib" aria-label="Next move" onClick={() => step(view.line, view.pos + 1)} disabled={view.pos >= lastPos(lines, view.line)}>
                <Chevron dir="right" />
              </button>
              {dto.divergence && (nb || !lineBoard.atSplit) ? (
                <button
                  type="button"
                  className={cn(buttonVariants({ variant: "text" }), "min-h-11 shrink-0")}
                  onClick={() => step(view.line, dto.divergence!.ply)}
                  data-testid="compare-jump-split"
                >
                  Go to Move {dto.divergence.moveLabel.replace(/[.…]$/, "")}
                </button>
              ) : null}
            </div>
            <div className="lc-tabs" role="tablist" aria-label="Compare views">
              {COMPARE_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`lc-tab-${t}`}
                  aria-controls="lc-panel"
                  aria-selected={view.tab === t}
                  tabIndex={view.tab === t ? 0 : -1}
                  className="lc-tab"
                  onClick={() => pickTab(t)}
                  onKeyDown={(e) => {
                    const i = COMPARE_TABS.indexOf(t);
                    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? COMPARE_TABS.length - 1 : null;
                    if (next === null) return;
                    e.preventDefault();
                    const tab = COMPARE_TABS[(next + COMPARE_TABS.length) % COMPARE_TABS.length]!;
                    pickTab(tab);
                    document.getElementById(`lc-tab-${tab}`)?.focus();
                  }}
                  data-testid={`compare-tab-${t}`}
                >
                  {TAB_LABEL(t, name)}
                </button>
              ))}
            </div>
            <div
              id="lc-panel"
              role="tabpanel"
              aria-labelledby={`lc-tab-${view.tab}`}
              tabIndex={0}
              className="lc-panel rc-scroll"
              data-testid="compare-tabpanel"
            >
              {panel}
            </div>
            <div className="lc-foot" data-rc-side-only="">
              {footerActions(false)}
            </div>
          </div>
        }
        footer={<div className="flex w-full gap-1.5 border-t border-cb-border bg-cb-surface px-3 pt-2">{footerActions(true)}</div>}
      />
    </div>
  );
}
