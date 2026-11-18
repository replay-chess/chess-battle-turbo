"use client";

// The Weakness Profile page (phase-06 plan §4; DR/V3WeaknessInsufficient, V3WeaknessComputing, V3WeaknessProfile,
// V3WeaknessDrill and the iPhone, Android, iPad L and iPad P profile boards). Presentational: every state renders from
// the payload and the view state, so the route (WeaknessScreen: query, socket, mutations) and the /dev/ui/weakness demo
// (fixtures) share it.
//
//   insufficient  header (scope label), the bullet-offer banner, InsufficientPanel
//   computing     header, ComputingPanel (or the ready flash once a watched build turns ready)
//   ready         header (‹ Train), headline + VERIFIED (+ Updating), grid: Top weaknesses (+ week plan) | breakdown
//                 tabs + strengths box; drill config inline (desktop, iPad L) or in the sheet (phones, iPad P)
//   failed        header, FailedPanel
import dynamic from "next/dynamic";
import type { WeaknessPayload, WeaknessRow, WeekPlanRow } from "@repo/contracts/http/weakness";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import type { WeaknessViewState } from "@/features/train/weakness/view-state";
import { cn } from "@/lib/utils";
import { BreakdownCard } from "./BreakdownCard";
import { BulletOfferBanner } from "./BulletOfferBanner";
import { ComputingPanel, ReadyFlash } from "./ComputingPanel";
import { copy, type WeaknessTab } from "./copy";
import { DrillConfig, type DrillControls } from "./DrillConfig";
import { FailedPanel } from "./FailedPanel";
import { InsufficientPanel } from "./InsufficientPanel";
import { insufficientModel, rowBySlug } from "./model";
import { StrengthsBox } from "./StrengthsBox";
import { WeaknessHeader } from "./WeaknessHeader";
import { WeaknessHeadline } from "./WeaknessHeadline";
import { FIT, FIT_COL, FIT_GRID, FIT_INNER, FRAME, INNER } from "./WeaknessFrame";
import { WeaknessList } from "./WeaknessList";
import { WeekPlanCard } from "./WeekPlanCard";

const DrillSheet = dynamic(() => import("./DrillSheet"), { ssr: false });

export type RecomputeUi = {
  pending: boolean;
  limit?: RetryCountdownState;
  failedAgain: boolean;
  eventId: string | null;
};

export type WeaknessHandlers = {
  onToggleRow: (index: number, row: WeaknessRow) => void;
  onToggleShowAll: () => void;
  onTab: (tab: WeaknessTab) => void;
  /** Opens the drill config (inline) or the sheet for a row. */
  onDrill: (row: WeaknessRow, entry: "row" | "plan") => void;
  onCloseDrill: () => void;
  onPlanFollow: (row: WeekPlanRow) => void;
  onSeeProfile: () => void;
  onRetry: () => void;
  onIncludeBullet: () => void;
  onImport: () => void;
  onPlay: () => void;
};

export type WeaknessViewProps = {
  payload: WeaknessPayload;
  view: WeaknessViewState;
  /** The pattern slug of the drill config (from the URL), or null. */
  selectedSlug: string | null;
  /** Phones and iPad portrait: the drill opens in the sheet. */
  sheetMode: boolean;
  /** A linked account exists and its import is idle: the CTA reads "Check for new games". */
  linked: boolean;
  drill: DrillControls;
  recompute: RecomputeUi;
  handlers: WeaknessHandlers;
};

export function WeaknessView({ payload, view, selectedSlug, sheetMode, linked, drill, recompute, handlers }: WeaknessViewProps) {
  const ready = payload.status === "ready" && !view.flash;
  const status = view.flash ? "ready_flash" : payload.status;
  const selected = ready ? rowBySlug(payload, selectedSlug) : null;

  return (
    <div data-rc-lock="" className="flex h-full min-h-0 flex-col" data-testid="weakness" data-status={status} data-selected={selected?.pattern}>
      <ScrollRegion label={copy.title} className={ready ? FIT : FRAME} data-testid="weakness-frame">
        <div className={ready ? FIT_INNER : INNER}>
          <WeaknessHeader scopeLabel={payload.scopeLabel} showBack={ready} hideScopeOnIpadL={ready} />
          {ready ? (
            <Ready payload={payload} view={view} selected={selected} sheetMode={sheetMode} drill={drill} handlers={handlers} />
          ) : payload.status === "insufficient" ? (
            <Insufficient payload={payload} linked={linked} recompute={recompute} handlers={handlers} />
          ) : view.flash ? (
            <ReadyFlash headline={payload.headline?.text ?? null} onSee={handlers.onSeeProfile} />
          ) : payload.status === "computing" && payload.progress ? (
            <ComputingPanel payload={payload} progress={payload.progress} />
          ) : (
            <FailedPanel paused={payload.failure?.retryable === false} onRetry={handlers.onRetry} retrying={recompute.pending} failedAgain={recompute.failedAgain} eventId={recompute.eventId} limit={recompute.limit} />
          )}
        </div>
      </ScrollRegion>
      {ready && sheetMode && selected ? <DrillSheet row={selected} rating={payload.rating} controls={drill} onClose={handlers.onCloseDrill} /> : null}
    </div>
  );
}

function Insufficient({ payload, linked, recompute, handlers }: { payload: WeaknessPayload; linked: boolean; recompute: RecomputeUi; handlers: WeaknessHandlers }) {
  const model = insufficientModel(payload);
  return (
    <>
      {model.bullet ? <BulletOfferBanner text={model.bullet.text} onInclude={handlers.onIncludeBullet} pending={recompute.pending} limit={recompute.limit} /> : null}
      <InsufficientPanel payload={payload} model={model} linked={linked} onImport={handlers.onImport} onPlay={handlers.onPlay} />
    </>
  );
}

function Ready({
  payload,
  view,
  selected,
  sheetMode,
  drill,
  handlers,
}: {
  payload: WeaknessPayload;
  view: WeaknessViewState;
  selected: WeaknessRow | null;
  sheetMode: boolean;
  drill: DrillControls;
  handlers: WeaknessHandlers;
}) {
  const inline = !sheetMode;
  const bandLabel = payload.listMode === "vs_band" ? (payload.band?.label ?? null) : null;
  return (
    <>
      <WeaknessHeadline payload={payload} />
      <div className={FIT_GRID} data-testid="weakness-grid">
        <div className={FIT_COL}>
          <WeaknessList
            payload={payload}
            openIndex={view.openIndex}
            showAll={view.showAll}
            selectedSlug={selected?.slug ?? null}
            inlineDrill={inline}
            onToggleRow={handlers.onToggleRow}
            onToggleShowAll={handlers.onToggleShowAll}
            onDrill={(row) => handlers.onDrill(row, "row")}
            config={(row) => (
              <div className="@container tabbar:hidden">
                <DrillConfig row={row} rating={payload.rating} controls={drill} layout="inline" />
              </div>
            )}
          />
          <WeekPlanCard
            rows={payload.weekPlan}
            onFollow={(row, e) => {
              handlers.onPlanFollow(row);
              const top = payload.top[0];
              if (row.kind === "drill" && top && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                e.preventDefault();
                handlers.onDrill(top, "plan");
              }
            }}
          />
        </div>
        <div className={cn(FIT_COL, "gap-3.5")}>
          {payload.breakdown ? <BreakdownCard breakdown={payload.breakdown} bandLabel={bandLabel} tab={view.tab} onTab={handlers.onTab} /> : null}
          {payload.breakdown ? <StrengthsBox strengths={payload.breakdown.strengths} /> : null}
        </div>
      </div>
    </>
  );
}
