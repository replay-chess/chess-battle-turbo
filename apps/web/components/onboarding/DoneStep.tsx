"use client";

// Done `/onboarding/done` (phase-04 plan §4.8, §5.4 "Done"; V3OnbDone, V3iPhoneOnbDone, V3iPadOnbDone).
// Board states (the import card): `importing`, `import_failed`, `imported`. Not drawn: nothing linked, zero games,
// and "Trial starting…" (the member came through "Continue in Background": completion waits for the passive
// activation watcher, Go to Home is disabled with "Almost there…"). A card that is declined meanwhile sends the member
// back to the plan with `?status=failed` (the watcher's onFailed, and the server on a reload; FIX-1), as Activating
// does.
//
// On mount (once entitled) the step completes onboarding: PATCH {complete: true} (useCompleteOnboarding: the Clerk
// session reloads, rc_onb covers the claim lag; 409 plan_required → the plan). "Go to Home" (primary, Enter) and
// "Play Your First Legend Position" (D4-14: only when the legacy position exists) leave once completion has landed,
// so middleware never bounces the member back to /onboarding. `onb_completed` is sent once.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import type { ActivationData } from "@repo/contracts/http/billing";
import type { MeData } from "@repo/contracts/http/me";
import { toWire, type DailyMinutes, type OnboardingGoalDb, type RatingBandDb } from "@repo/contracts/http/p04-plain";
import { LiveImportProgressCard } from "@/components/import/ImportProgressCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { qk } from "@/lib/api/keys";
import { useCompleteOnboarding } from "@/lib/api/mutations/onboarding";
import { useMe } from "@/lib/api/queries/me";
import {
  ALMOST_THERE,
  LEGEND_ASIDE_CAPTION,
  LEGEND_ASIDE_LABEL,
  doneBody,
  donePlanFailedHref,
  doneTag,
  totalOnboardingMs,
} from "@/lib/onboarding/done-view";
import type { ProviderSlug } from "@/lib/onboarding/import-card";
import { clearOnboardingStart, onboardingStartedAt, trackOnboarding } from "@/lib/onboarding/telemetry";
import { cn } from "@/lib/utils";
import { ActivationWatcher } from "./ActivationWatcher";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";

export type DonePanelProps = {
  entitled: boolean;
  trialActive: boolean;
  daysLeft: number | null;
  /** "Chess.com", "Chess.com and Lichess" or null. */
  providers: string | null;
  /** The import card (live, or a fixture on the demo routes). */
  importCard: React.ReactNode;
  board: React.ReactNode;
  /** The legacy legend position (D4-14), or null: the CTA is hidden. */
  legendHref: string | null;
  /** Completion is landing and a click is waiting for it. */
  leaving: "home" | "first_position" | null;
  onHome?: () => void;
  onFirstPosition?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
};

/** The step without data: the live step and the demo routes render it. */
export function DonePanel(p: DonePanelProps) {
  const tag = doneTag({ entitled: p.entitled, trialActive: p.trialActive, daysLeft: p.daysLeft });
  const hintId = "onb-done-almost";
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (p.entitled) p.onHome?.();
  };

  return (
    <OnbStage
      label="All set"
      state={p.entitled ? "ready" : "trial_starting"}
      testId="onb-done"
      onSubmit={onSubmit}
      aside={
        <>
          <span className="onb-lbl">{LEGEND_ASIDE_LABEL}</span>
          <div className="onb-ab">{p.board}</div>
          <p className="onb-p onb-tall">{LEGEND_ASIDE_CAPTION}</p>
        </>
      }
      inline={{ kind: "board", board: p.board, label: LEGEND_ASIDE_LABEL, tabletWidth: 440 }}
      footer={
        <OnbFooter
          secondary={
            p.legendHref ? (
              // No prefetch: the click waits for completion and then pushes (DoneStep `leave`), so a viewport prefetch
              // only costs an invocation on every Done load (plan §5.4 lists none for this CTA, §5.9 budgets one
              // prefetch for the whole flow), and made before completion it is middleware's onboarding redirect, which
              // a production build could replay on the click (as done-destination-prefetch below; regression:
              // p04-done-legend-prefetch, e2e/specs/onboarding/happy-path.spec.ts).
              <Link
                href={p.legendHref}
                prefetch={false}
                onClick={p.onFirstPosition}
                aria-disabled={p.entitled ? undefined : true}
                className={cn(buttonVariants({ variant: "secondary" }), "onb-secondary")}
                data-testid="onb-first-position"
              >
                <span className="onb-only-wide">Play Your First Legend Position</span>
                <span className="onb-only-phone">Play First Legend Position</span>
              </Link>
            ) : null
          }
          primary={
            <span className="onb-done-cta">
              <Button
                type="submit"
                size="lg"
                className="onb-primary"
                loading={p.leaving === "home"}
                aria-disabled={p.entitled ? undefined : true}
                aria-describedby={p.entitled ? undefined : hintId}
                iconEnd={<ArrowRight aria-hidden="true" />}
                data-testid="onb-go-home"
              >
                Go to Home
              </Button>
              {p.entitled ? null : (
                <span className="onb-hint" id={hintId} data-testid="onb-done-almost">
                  {ALMOST_THERE}
                </span>
              )}
            </span>
          }
        />
      }
    >
      <span className="onb-done-tags">
        <Tag tone="good" icon={<Check aria-hidden="true" />}>
          Setup complete
        </Tag>
        {tag ? (
          <Tag tone="warn" className="bg-cb-warn-bg" data-state={tag.tone} data-testid="onb-done-trial-tag">
            {tag.text}
          </Tag>
        ) : null}
      </span>
      <StepHeading>You&apos;re set.</StepHeading>
      <p className="onb-p">{doneBody(p.providers)}</p>
      {p.importCard}
    </OnbStage>
  );
}

export type DoneSummary = {
  ratingBand: RatingBandDb | null;
  goals: OnboardingGoalDb[];
  dailyMinutes: DailyMinutes | null;
};

export type DoneStepProps = {
  /** Entitled, admin or paywall off (the resolver's entitledLike) at render time. */
  entitled: boolean;
  trialActive: boolean;
  daysLeft: number | null;
  providers: string | null;
  linked: ProviderSlug[];
  /** `rc_onb_next` / `?redirect_url=` or /games (D4-13). */
  destination: string;
  legendHref: string | null;
  board: React.ReactNode;
  /** Not entitled yet: the passive watcher's seed (getActivation, database only). */
  watch: ActivationData | null;
  summary: DoneSummary;
};

export function DoneStep(props: DoneStepProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const complete = useCompleteOnboarding();
  // The seeded viewer (layout); the watcher writes the new entitlement into it when the trial starts.
  const { data: meEntitlement } = useMe((me) => me.entitlement);
  const [entitled, setEntitled] = useState(props.entitled);
  const [leaving, setLeaving] = useState<{ cta: "home" | "first_position"; to: string } | null>(null);
  const completedSent = useRef(false);

  useEffect(() => {
    trackOnboarding("onb_step_viewed", { step: "done" });
  }, []);

  const { mutate, isSuccess, isError, isPending } = complete;

  // No prefetch of the destination: before completion middleware answers it with the onboarding redirect, and after
  // it the import is usually still saving, so a prefetched /games would show the archive as it was then (0 games);
  // a production build replays either on "Go to Home" (regression: done-destination-prefetch,
  // e2e/specs/onboarding/happy-path.spec.ts).
  const run = () =>
    mutate(
      {},
      {
        onSuccess: () => {
          if (completedSent.current) return;
          completedSent.current = true;
          const e = qc.getQueryData<MeData>(qk.me())?.entitlement;
          trackOnboarding("onb_completed", {
            total_ms: totalOnboardingMs(onboardingStartedAt(), Date.now()),
            linked_providers: props.linked,
            rating_band: props.summary.ratingBand ? toWire(props.summary.ratingBand) : null,
            goals: props.summary.goals.map((g) => toWire(g)),
            daily_minutes: props.summary.dailyMinutes,
            plan: e?.planKey === "monthly" || e?.planKey === "yearly" ? e.planKey : null,
            is_trial: e?.trial.active ?? props.trialActive,
          });
          clearOnboardingStart();
        },
      },
    );

  // Complete once the membership is live (at once, or when the watcher sees the trial start).
  const started = useRef(false);
  useEffect(() => {
    if (!entitled || started.current) return;
    started.current = true;
    run();
  });

  // A click that waited for completion leaves when it lands.
  useEffect(() => {
    if (leaving && isSuccess) router.push(leaving.to);
  }, [leaving, isSuccess, router]);

  const leave = (cta: "home" | "first_position", to: string) => {
    if (!entitled) return;
    trackOnboarding("onb_done_cta_clicked", { cta });
    if (isSuccess) {
      router.push(to);
      return;
    }
    setLeaving({ cta, to });
    if (isError && !isPending) run();
  };

  return (
    <>
      {props.watch && !entitled ? (
        <ActivationWatcher
          initial={props.watch}
          onActive={() => setEntitled(true)}
          onFailed={() => router.replace(donePlanFailedHref(props.watch))}
        />
      ) : null}
      <DonePanel
        entitled={entitled}
        trialActive={meEntitlement?.trial.active ?? props.trialActive}
        daysLeft={meEntitlement?.trial.daysLeft ?? props.daysLeft}
        providers={props.providers}
        board={props.board}
        legendHref={props.legendHref}
        leaving={leaving && !isError ? leaving.cta : null}
        importCard={
          <LiveImportProgressCard
            context="done"
            linked={props.linked}
            entitled={entitled}
            trial={meEntitlement?.trial.active ?? props.trialActive}
            onRetryClick={(provider) => trackOnboarding("onb_import_retry_clicked", { provider })}
          />
        }
        onHome={() => leave("home", props.destination)}
        onFirstPosition={(e) => {
          e.preventDefault();
          if (props.legendHref) leave("first_position", props.legendHref);
        }}
      />
    </>
  );
}
