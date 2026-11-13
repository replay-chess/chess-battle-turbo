"use client";

// Plan `/onboarding/plan` (phase-04 plan §4.6; V3OnbPlan, V3iPhoneOnbPlan, V3iPadOnbPlan).
// Board states: `default` and `loading` (the checkout POST until the browser leaves for Dodo: "Opening secure
// checkout…" + spinner); prop `plan` monthly | yearly (`?plan=`, router.replace: no history entry). Not drawn:
// trial used, a failed card (`?status=failed`, with the passive activation watcher), an abandoned checkout
// (`?resume=abandoned`), a start error (inline banner with Retry and the request id), 503 not_configured and 429
// (RetryCountdown under the button). Start = useStartCheckout({plan, source: "onboarding"}) → Dodo's hosted page;
// 409 already_subscribed → Done; 402 → the billing portal (the hook). Enter = Start; Alt+← = Back (Goals).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, RotateCw } from "lucide-react";
import type { ActivationData } from "@repo/contracts/http/billing";
import { TrialTermsLine } from "@/components/billing/TrialTermsLine";
import { useRetryCountdown } from "@/components/system/useRetryCountdown";
import { Button, buttonVariants } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { isApiError } from "@/lib/api/errors";
import { useStartCheckout } from "@/lib/api/mutations/billing";
import { ACTIVATION_FEATURES } from "@/lib/billing/activation-copy";
import { BILLING_PLANS, type PlanKey } from "@/lib/billing/plans";
import {
  CHECKOUT_HINT,
  CTA_LOADING,
  checkoutErrorView,
  planCard,
  planCopy,
  planTimeline,
  yearlyDiscountLabel,
  type PlanBanner,
} from "@/lib/onboarding/plan-view";
import { stepPath } from "@/lib/onboarding/steps";
import { trackOnboarding } from "@/lib/onboarding/telemetry";
import { cn } from "@/lib/utils";
import { OnbFooter, OnbStage, StepHeading } from "./OnbStage";
import { PlanTimeline } from "./PlanTimeline";
import { submitOnEnter } from "./submit-on-enter";

// Loaded only after a failed card return: the plan chunk itself carries no realtime / activation code (§9.6).
const ActivationWatcher = dynamic(() => import("./ActivationWatcher").then((m) => m.ActivationWatcher), { ssr: false });
// Off the default path (a declined or abandoned checkout, a rate-limited Start): loaded only when shown, server-rendered
// when the page opens in that state (FIX-2, plan §9.6: the step's First Load JS ≤ 140 kB).
const Banner = dynamic(() => import("@/components/ui/banner").then((m) => m.Banner));
const RetryCountdown = dynamic(() => import("@/components/system/RetryCountdown").then((m) => m.RetryCountdown));

export type PlanStepProps = {
  trialEligible: boolean;
  initialPlan: PlanKey;
  /** From `?status=failed` / `?resume=abandoned` (planBanner()). */
  banner: PlanBanner | null;
  /** "6 Nov": today + 7 days in the viewer's zone (server). */
  chargeDateLabel: string | null;
  /** "Chess.com", "Chess.com and Lichess" or null (the timeline's first row). */
  providers: string | null;
  timeZone: string;
  /** The request clock (ISO), so TrialTermsLine renders the same date on the server and the client. */
  nowIso: string;
  /** After a failed card: the server's activation answer (the passive watcher's seed); null otherwise. */
  watch: ActivationData | null;
  demo?: boolean;
  /** Demo only: the board's `loading` state, or an error state that needs a server answer to reach. */
  demoState?: "loading" | "start_error" | "not_configured";
};

const PLAN_ITEMS: { value: PlanKey; label: React.ReactNode }[] = [
  { value: "monthly", label: "Monthly" },
  {
    value: "yearly",
    label: (
      <>
        Yearly <span className="onb-mono onb-seg__off">{yearlyDiscountLabel()}</span>
      </>
    ),
  },
];

export function PlanStep(props: PlanStepProps) {
  const { trialEligible, demo = false, demoState } = props;
  const router = useRouter();
  const [plan, setPlan] = useState<PlanKey>(props.initialPlan);
  const checkout = useStartCheckout();
  const limit = useRetryCountdown(checkout, { routeId: "billing.checkout" });
  const shownAt = useRef(0);

  useEffect(() => {
    shownAt.current = performance.now();
    if (demo) return;
    trackOnboarding("onb_step_viewed", { step: "plan" });
    trackOnboarding("onb_plan_viewed", { plan_default: props.initialPlan, is_trial_eligible: trialEligible });
  }, [demo, props.initialPlan, trialEligible]);

  const error = checkout.error;
  const errorView =
    demoState === "start_error"
      ? checkoutErrorView("upstream_unavailable")
      : demoState === "not_configured"
        ? checkoutErrorView("not_configured")
        : isApiError(error)
          ? checkoutErrorView(error.code)
          : error
            ? checkoutErrorView("network")
            : null;
  const toDone = errorView?.kind === "navigate" && errorView.to === "done";
  useEffect(() => {
    // 409 already_subscribed: the hook refetched the viewer; the member belongs on Done (the plan is skipped).
    if (toDone) router.replace(stepPath("done"));
  }, [toDone, router]);

  const copy = planCopy(trialEligible);
  const card = planCard(plan);
  const timeline = planTimeline({ trialEligible, chargeDateLabel: props.chargeDateLabel, providers: props.providers });
  // Pending until the browser has left for Dodo (a success navigates; the bfcache Back resets the mutation).
  const loading = demoState === "loading" || checkout.isPending || checkout.isSuccess;
  const state = loading ? "loading" : "default";

  const choosePlan = (value: PlanKey) => {
    setPlan(value);
    if (demo) return;
    trackOnboarding("onb_plan_toggled", { plan: value });
    const params = new URLSearchParams(window.location.search);
    params.set("plan", value);
    router.replace(`${stepPath("plan")}?${params.toString()}`, { scroll: false });
  };

  const start = () => {
    if (demo || loading || limit.limited) return;
    checkout.reset();
    trackOnboarding("onb_step_completed", { step: "plan", ms_on_step: Math.round(performance.now() - shownAt.current) });
    checkout.mutate({ plan, source: "onboarding" });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start();
  };

  const requestId = demoState === "start_error" ? "req_demo_8f2k" : isApiError(error) ? (error.requestId ?? null) : null;
  const startError =
    errorView?.kind === "retry"
      ? { text: errorView.text, requestId, retry: true }
      : errorView?.kind === "unavailable"
        ? { text: errorView.text, requestId: null, retry: false }
        : null;

  const aside = (
    <div className="onb-card onb-tl-card">
      <PlanTimeline rows={timeline} variant="full" />
      <p className="onb-hint onb-tl-card__hint">{CHECKOUT_HINT}</p>
    </div>
  );

  return (
    <OnbStage
      label="Choose a plan"
      state={state}
      testId="onb-plan"
      onSubmit={onSubmit}
      aside={aside}
      inline={{
        kind: "card",
        node: (
          <>
            <div className="onb-card onb-tl-card onb-only-tablet">
              <PlanTimeline rows={timeline} variant="full" />
              <p className="onb-hint onb-tl-card__hint">{CHECKOUT_HINT}</p>
            </div>
            <div className="onb-card onb-only-phone">
              <PlanTimeline rows={timeline} variant="mini" />
            </div>
          </>
        ),
      }}
      footer={
        <OnbFooter
          secondary={
            <Link href={stepPath("goals")} className={cn(buttonVariants({ variant: "secondary" }), "onb-secondary")} data-testid="onb-back">
              Back
            </Link>
          }
          primary={
            <span className="onb-plan-cta">
              <Button
                type="submit"
                size="lg"
                className="onb-primary"
                loading={loading}
                loadingLabel={CTA_LOADING}
                {...limit.controlProps}
                iconEnd={loading ? undefined : <ArrowRight aria-hidden="true" />}
                data-testid="onb-start-checkout"
              >
                {copy.cta}
              </Button>
              <RetryCountdown countdown={limit} data-testid="onb-plan-countdown" />
              <TrialTermsLine
                trial={trialEligible}
                interval={BILLING_PLANS[plan].interval}
                timeZone={props.timeZone}
                now={new Date(props.nowIso)}
                className="onb-plan-terms"
              />
            </span>
          }
        />
      }
    >
      {props.watch && !demo ? <ActivationWatcher initial={props.watch} onActive={() => router.replace(stepPath("done"))} /> : null}
      <StepHeading>{copy.h1}</StepHeading>
      <p className="onb-p onb-only-wide">{copy.lead}</p>
      <p className="onb-p onb-only-phone">{copy.leadShort}</p>
      <div onKeyDown={submitOnEnter} className="onb-seg-wrap">
        <Segmented aria-label="Billing period" value={plan} onValueChange={choosePlan} items={PLAN_ITEMS} className="onb-seg" data-testid="onb-plan-period" />
      </div>
      {props.banner ? (
        <Banner tone={props.banner.tone} live="off" data-testid={props.banner.testId}>
          {props.banner.text}
        </Banner>
      ) : null}
      {startError ? (
        <Banner
          tone="bad"
          live="assertive"
          data-testid="onb-plan-error"
          action={
            startError.retry ? (
              <Button type="button" size="sm" variant="secondary" iconStart={<RotateCw aria-hidden="true" />} onClick={start}>
                Retry
              </Button>
            ) : undefined
          }
        >
          {startError.text}
          {startError.requestId ? (
            <>
              {" "}
              <span className="onb-mono onb-xs">Request ID {startError.requestId}</span>
            </>
          ) : null}
        </Banner>
      ) : null}
      <section
        className="onb-card onb-plancard"
        aria-label="Coaching plan"
        data-squeeze={props.banner || startError ? "" : undefined}
        data-testid="onb-plan-card"
      >
        <div className="onb-plancard__head">
          <span className="onb-lbl">{card.name}</span>
          <span className="onb-hint">{card.note}</span>
        </div>
        <span className="onb-plancard__price" data-testid="onb-plan-price">
          {card.price}
          <span className="onb-plancard__per"> {card.per}</span>
        </span>
        <ul className="onb-check onb-plancard__list">
          {ACTIVATION_FEATURES.map((f) => (
            <li key={f}>
              <Check aria-hidden="true" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </section>
    </OnbStage>
  );
}
