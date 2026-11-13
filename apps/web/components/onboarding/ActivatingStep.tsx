"use client";

// Activating `/onboarding/activating` (phase-04 plan §4.7, §5.4, §5.6, §8.5; V3OnbActivating, V3iPhoneOnbActivating,
// V3iPadOnbActivating). Dodo returns here (`?checkout=success&plan=…`, Dodo appends `subscription_id`, `status`).
// States: `polling` (eyebrow "Confirming your card", spinner, indeterminate bar; "Continue in Background" → Done),
// `stalled` (12 s: "Contact Support" + "Check Again", a forced Dodo lookup; polling continues) and `success`
// ("Active", "Continue" → Done). Not drawn: `failed` → replace to `/onboarding/plan?status=failed&plan=…`.
//
// The state card is WP-D's ActivationCard (kind "onboarding"), drawn bare inside the panel as the board does; its
// actions live in the frame's pinned footer (V3OnbActivating `.ofoot`), so the card renders no action row
// (`actions={false}`). The import card shows D4-07's "Waiting for your trial to start" until the trial is
// live, then the import itself. useActivation (WP-D) polls BIL-2 on the §5.7 schedule even with the socket up and
// listens for `entitlement:changed` through the critical "activation" hold; on success it reloads the Clerk session,
// refreshes the socket token and writes `qk.me()`.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateCw } from "lucide-react";
import type { ActivationData, ActivationQuery } from "@repo/contracts/http/billing";
import { ActivationCard, type ActivationCardPhase } from "@/components/billing/ActivationCard";
import { LiveImportProgressCard } from "@/components/import/ImportProgressCard";
import { Button, buttonVariants } from "@/components/ui/button";
import { shortDateLabel } from "@/lib/billing/activation-copy";
import { leaveActivation } from "@/lib/billing/client";
import { trackBilling } from "@/lib/billing/telemetry";
import { useActivation } from "@/lib/billing/useActivation";
import type { PlanKey } from "@/lib/billing/plans";
import { ACTIVATING_ASIDE_CAPTION, ACTIVATING_ASIDE_LABEL } from "@/lib/onboarding/done-view";
import type { ProviderSlug } from "@/lib/onboarding/import-card";
import { stepPath } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { cn } from "@/lib/utils";
import { OnbFooter, OnbStage } from "./OnbStage";

/** The card's chrome removed: it reads as the panel's own content (V3OnbActivating draws no card). */
const BARE_CARD = "gap-4 border-0 bg-transparent p-0 max-[900px]:p-0 max-[600px]:gap-2.5 max-[600px]:p-0 [@media(max-height:640px)]:gap-2.5 [@media(max-height:640px)]:p-0";

export type ActivatingPanelProps = {
  phase: ActivationCardPhase;
  isTrial: boolean;
  chargeDateLabel: string | null;
  checking: boolean;
  supportHref: string;
  /** Where a failed card goes ("Try Again" while the replace runs). */
  planHref: string;
  importCard: React.ReactNode;
  board: React.ReactNode;
  onContinue?: () => void;
  onContinueInBackground?: () => void;
  onCheckAgain?: () => void;
  onSupport?: () => void;
};

/** Where the form goes before hydration: Done for "continue" (polling, success); a stalled card reloads itself. */
export function activatingFormAction(phase: ActivationCardPhase): string | undefined {
  return phase === "polling" || phase === "success" ? stepPath("done") : undefined;
}

/** The step without data: the live step and the demo routes render it. */
export function ActivatingPanel(p: ActivatingPanelProps) {
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (p.phase === "polling") p.onContinueInBackground?.();
    else if (p.phase === "stalled") p.onCheckAgain?.();
    else if (p.phase === "success") p.onContinue?.();
  };

  let footer: React.ReactNode;
  if (p.phase === "stalled") {
    footer = (
      <OnbFooter
        secondary={
          <Link href={p.supportHref} onClick={p.onSupport} className={cn(buttonVariants({ variant: "secondary" }), "onb-secondary")} data-testid="onb-contact-support">
            Contact Support
          </Link>
        }
        primary={
          <Button type="submit" size="lg" className="onb-primary" loading={p.checking} loadingLabel="Checking…" iconStart={<RotateCw aria-hidden="true" />} data-testid="onb-check-again">
            Check Again
          </Button>
        }
      />
    );
  } else if (p.phase === "success") {
    footer = (
      <OnbFooter
        primary={
          <Button type="submit" size="lg" className="onb-primary" iconEnd={<ArrowRight aria-hidden="true" />} data-testid="onb-activating-continue">
            Continue
          </Button>
        }
      />
    );
  } else if (p.phase === "failed") {
    footer = (
      <OnbFooter
        primary={
          <Link href={p.planHref} className={cn(buttonVariants({ size: "lg" }), "onb-primary")} data-testid="onb-activating-try-again">
            Try Again
          </Link>
        }
      />
    );
  } else {
    footer = (
      <OnbFooter
        primary={
          <Button type="submit" variant="secondary" className="onb-secondary" data-testid="onb-continue-background">
            Continue in Background
          </Button>
        }
      />
    );
  }

  return (
    <OnbStage
      label="Activating"
      state={p.phase}
      testId="onb-activating"
      onSubmit={onSubmit}
      action={activatingFormAction(p.phase)}
      aside={
        <>
          <span className="onb-lbl">{ACTIVATING_ASIDE_LABEL}</span>
          <div className="onb-ab">{p.board}</div>
          <p className="onb-p">{ACTIVATING_ASIDE_CAPTION}</p>
        </>
      }
      inline={{ kind: "board", board: p.board, label: ACTIVATING_ASIDE_LABEL, tabletAt: "end", caption: ACTIVATING_ASIDE_CAPTION }}
      footer={footer}
    >
      <div className="onb-act">
        <ActivationCard
          kind="onboarding"
          phase={p.phase}
          isTrial={p.isTrial}
          chargeDateLabel={p.chargeDateLabel}
          checking={p.checking}
          supportHref={p.supportHref}
          onCheckAgain={p.onCheckAgain}
          onSupportClick={p.onSupport}
          className={BARE_CARD}
          actions={false}
        />
      </div>
      {p.importCard}
    </OnbStage>
  );
}

/** Trial or paid: what the member has (entitled), else what the pending checkout offered (as /checkout/activating). */
export function isTrialActivation(data: ActivationData): boolean {
  return data.entitlement.entitled ? data.entitlement.trial.active : data.trial.chargeDate !== null;
}

export type ActivatingStepProps = {
  params: ActivationQuery;
  initial: ActivationData;
  isReturn: boolean;
  plan: PlanKey;
  timeZone: string;
  /** Providers with an ACTIVE link (the import card). */
  linked: ProviderSlug[];
  board: React.ReactNode;
};

export function ActivatingStep(props: ActivatingStepProps) {
  const router = useRouter();
  const a = useActivation({ kind: "onboarding", params: props.params, initial: props.initial, isReturn: props.isReturn, source: "onboarding" });
  const { state, data } = a;
  const planHref = `${stepPath("plan")}?status=failed&plan=${props.plan}`;
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
    trackOnboarding("onb_step_viewed", { step: "activating" });
  }, []);

  useEffect(() => {
    if (state.phase === "failed") router.replace(planHref);
  }, [state.phase, router, planHref]);

  const isTrial = isTrialActivation(data);
  const entitled = state.phase === "success" || data.entitlement.entitled;
  const toDone = () => {
    trackOnboarding("onb_step_completed", { step: "activating", ms_on_step: Math.round(performance.now() - shownAt.current) });
    leaveActivation(stepPath("done"));
  };

  return (
    <ActivatingPanel
      phase={state.phase}
      isTrial={isTrial}
      chargeDateLabel={shortDateLabel(data.trial.chargeDate ?? data.trial.endsAt, props.timeZone)}
      checking={a.checking}
      supportHref={`/contact?topic=billing${data.reference ? `&ref=${encodeURIComponent(data.reference)}` : ""}`}
      planHref={planHref}
      board={props.board}
      importCard={<LiveImportProgressCard context="activating" linked={props.linked} entitled={entitled} trial={isTrial} />}
      onContinue={toDone}
      onContinueInBackground={() => {
        trackOnboarding("onb_activating_continue_background", { source: "onboarding" });
        leaveActivation(stepPath("done"));
      }}
      onCheckAgain={a.checkAgain}
      onSupport={() => trackBilling("checkout_support_clicked", { source: "onboarding" })}
    />
  );
}
