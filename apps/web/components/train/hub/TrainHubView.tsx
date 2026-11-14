"use client";

// The Train hub (phase-05 plan §4.2; DR/V3TrainHub, V3TrainHubDone, V3TrainHubLoading and the iPhone, Android, iPad L
// and iPad P boards). Presentational: every state renders from props, so the route (TrainHubScreen: query, socket,
// timers) and the /dev/ui/train/hub demo (fixtures) share it.
//
// Layout (one viewport, lock mode: only the ScrollRegion scrolls, and only as a fallback since there is no board):
// - desktop: header (eyebrow, h1 Train, streak), grid 1.55fr / 1fr: plan + due strip | All training + Theme mastery;
// - rail (iPad landscape, desktop ≥ 125 %): the same two columns, the due strip 2 × 2 with 4 thumbnails;
// - iPad portrait: one column, every section;
// - phones: "Train" in the top bar, the streak chip, the plan, All training, the CTA sticky above the tab bar; no due
//   strip and no mastery block (the boards' designed omission).
// `planLoading` is the in-place state while a day rollover refetches the plan (V3TrainHubLoading's plan card): the
// header and All training stay.
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { RetryCountdown } from "@/components/system/RetryCountdown";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import type { TrainToday } from "@repo/contracts/http/train";
import Link from "next/link";
import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { ctaOf, dueStripModel, eyebrowOf, nextBatchShort, phoneStreakChip, planModel, type HubCta } from "./model";
import {
  AllTrainingList,
  CARD,
  DueStrip,
  HubFootnote,
  PlanHeading,
  PlanStepList,
  StreakWeek,
  ThemeMasteryBars,
  type HubLinkTarget,
} from "./parts";

export type TrainHubViewProps = {
  today: TrainToday;
  /** The day word of `nextBatch.at` ("tomorrow"), computed by the caller against a hydration-stable clock. */
  nextDay: string | null;
  /** The plan section shows its skeleton while a day rollover refetches it. */
  planLoading?: boolean;
  onStart: () => void;
  starting: boolean;
  /** The start mutation's 429 countdown (inline under the CTA). */
  startLimit?: RetryCountdownState;
  onFollow?: (target: HubLinkTarget) => void;
};

function Cta({
  cta,
  onStart,
  starting,
  startLimit,
  className,
  testId,
}: {
  cta: HubCta;
  onStart: () => void;
  starting: boolean;
  startLimit?: RetryCountdownState;
  className?: string;
  testId: string;
}) {
  if (cta.kind === "none") return null;
  if (cta.kind === "link") {
    return (
      <Link href={cta.href} prefetch={false} className={cn(buttonVariants({ variant: "secondary", size: "lg" }), className)} data-testid={testId}>
        {cta.label}
      </Link>
    );
  }
  return (
    <Button
      size="lg"
      loading={starting}
      onClick={() => {
        if (!startLimit?.limited) onStart();
      }}
      className={className}
      data-testid={testId}
      {...(startLimit?.controlProps ?? {})}
    >
      {cta.label}
    </Button>
  );
}

function PlanSkeleton() {
  return (
    <SkeletonRegion label="Loading today’s plan" className={cn(CARD, "flex flex-col gap-3.5 p-4")}>
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className={cn("h-12 w-60", "[@media(max-width:600px)]:hidden")} />
    </SkeletonRegion>
  );
}

export function TrainHubView({ today, nextDay, planLoading = false, onStart, starting, startLimit, onFollow }: TrainHubViewProps) {
  const plan = planModel(today, nextDay);
  const cta = ctaOf(today);
  const strip = dueStripModel(today);
  const chip = phoneStreakChip(today);
  const phoneLine = today.state === "nothingdue" ? (today.due.waitingLine ?? nextBatchShort(today, nextDay)) : null;
  const state = planLoading ? "loading" : today.state;

  return (
    <div data-rc-lock="" className="flex h-full min-h-0 flex-col" data-testid="train-hub" data-state={state}>
      <TopBarTitle>
        <span className="text-overline text-cb-text">Train</span>
      </TopBarTitle>
      <ScrollRegion
        label="Train"
        className={cn(
          "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-center-safe px-8 py-7 narrow:p-5 vh640:px-6 vh640:py-3.5",
          "tabbar:items-start tabbar:px-6 tabbar:py-4",
          "[@media(max-width:600px)]:px-4 [@media(max-width:600px)]:pt-1 [@media(max-width:600px)]:pb-3",
        )}
      >
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 [@media(max-width:600px)]:gap-3.5">
          <header className={cn("flex flex-wrap items-end justify-between gap-6", "[@media(max-width:600px)]:hidden")} data-testid="train-header">
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-overline">{eyebrowOf(today)}</p>
              <h1 className="m-0 font-serif text-[clamp(2rem,4.9vh,3rem)]/[1.05] font-normal tracking-[-0.01em] text-cb-text">Train</h1>
            </div>
            <StreakWeek streak={today.streak} />
          </header>
          {/* Phones: the streak chip replaces the header (the top bar says "Train"). */}
          <div className={cn("hidden items-center justify-between gap-3", "[@media(max-width:600px)]:flex")} data-testid="train-streak-chip">
            <h1 className="sr-only">Train</h1>
            <span className="flex items-center gap-2 font-medium" role="img" aria-label={today.streak.aria}>
              <Flame aria-hidden="true" className="size-[18px]" />
              <span aria-hidden="true">{chip.title}</span>
            </span>
            <span className="font-mono text-xs text-cb-text-soft uppercase">{chip.minutes}</span>
          </div>

          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-6 tabbar:grid-cols-[minmax(0,1fr)] tabbar:gap-4">
            <div className="flex min-w-0 flex-col gap-5 tabbar:gap-4">
              {planLoading ? (
                <PlanSkeleton />
              ) : (
                <section aria-labelledby="train-plan-h" className={cn(CARD, "flex flex-col")} data-testid="train-plan">
                  <PlanHeading id="train-plan-h" plan={plan} />
                  <PlanStepList
                    steps={today.plan.steps}
                    onFollow={(i) => {
                      if (i === 0) onFollow?.("step_1");
                      else if (i === 1) onFollow?.("step_2");
                    }}
                  />
                  {/* Desktop and iPad: the CTA row inside the card. Phones: the line only; the CTA is sticky below. */}
                  {plan.line ? (
                    <div className="flex flex-wrap items-center gap-3 border-t border-cb-border px-4 py-3.5" data-testid="train-plan-line">
                      <span className={cn("text-body", "[@media(max-width:600px)]:hidden")} role="status">
                        {plan.line}
                      </span>
                      {phoneLine ? <span className={cn("hidden text-sm", "[@media(max-width:600px)]:inline")}>{phoneLine}</span> : null}
                      {cta.kind !== "none" ? (
                        <Cta cta={cta} onStart={onStart} starting={starting} startLimit={startLimit} className={"[@media(max-width:600px)]:hidden"} testId="train-plan-cta" />
                      ) : null}
                    </div>
                  ) : cta.kind !== "none" ? (
                    <div className={cn("flex flex-wrap items-center gap-3 border-t border-cb-border px-4 py-3.5", "[@media(max-width:600px)]:hidden")}>
                      <Cta cta={cta} onStart={onStart} starting={starting} startLimit={startLimit} testId="train-plan-cta" />
                      <HubFootnote text={today.plan.footnote} />
                    </div>
                  ) : null}
                  {startLimit ? <RetryCountdown countdown={startLimit} className="px-4 pb-3" /> : null}
                </section>
              )}
              <div className={"[@media(max-width:600px)]:hidden"}>
                <DueStrip today={today} mode={strip} onFollowThumb={() => onFollow?.("thumb")} onFollowBank={() => onFollow?.("bank")} />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-5 tabbar:gap-4">
              <AllTrainingList today={today} onFollow={(t) => onFollow?.(t)} />
              <div className={"[@media(max-width:600px)]:hidden"}>
                <ThemeMasteryBars mastery={today.mastery} />
              </div>
            </div>
          </div>
        </div>
      </ScrollRegion>
      {/* Phones: the CTA sticks above the tab bar. */}
      {cta.kind !== "none" && !planLoading ? (
        <div className={cn("hidden shrink-0 border-t border-cb-border bg-cb-bg px-4 pt-2 pb-2", "[@media(max-width:600px)]:grid")} data-testid="train-sticky-cta">
          <Cta cta={cta} onStart={onStart} starting={starting} startLimit={startLimit} className="w-full" testId="train-sticky-cta-button" />
        </div>
      ) : planLoading ? (
        <div className={cn("hidden shrink-0 border-t border-cb-border bg-cb-bg px-4 pt-2 pb-2", "[@media(max-width:600px)]:block")}>
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
    </div>
  );
}
