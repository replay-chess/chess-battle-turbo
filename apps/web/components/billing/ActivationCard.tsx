"use client";

// ActivationCard (phase-04 plan 4.7, 4.9; boards DR/V3CheckoutActivating, DR/V3OnbActivating and their iPhone/iPad
// variants). The state card shared by `/checkout/activating` (kind "checkout") and `/onboarding/activating`
// (kind "onboarding", WP-F). Presentational: the page runs useActivation() and passes the phase and the labels.
//
// a11y: only the state line (the eyebrow / tag) is a polite live region; focus moves to the h1 on every phase change
// (the countdown is not announced); the indeterminate bar is a `progressbar` with `aria-valuetext`.
import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clock, RotateCw, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";


/** The onboarding success body of a paid (non-trial) activation: what happens next, never the title again. */
export const PAID_SUCCESS_BODY = "Thanks for joining. Continue to finish setting up.";
export type ActivationCardPhase = "polling" | "stalled" | "success" | "failed";

export type ActivationCardProps = {
  kind: "checkout" | "onboarding";
  phase: ActivationCardPhase;
  /** A trial checkout ("Starting your trial…") or a paid one ("Activating your membership…"). */
  isTrial: boolean;
  /** Entitled on arrival without a checkout return: "You're already a member." and no countdown. */
  alreadyMember?: boolean;
  /** "6 Nov": the first charge (the trial's end). */
  chargeDateLabel: string | null;
  /** "5 Nov": the trial's last day (checkout success hint). */
  trialEndsLabel?: string | null;
  /** "$4.99" (checkout success hint). */
  priceLabel?: string | null;
  /** "Play", "My games" (checkout: "Taking you back to …"). */
  destinationLabel?: string | null;
  /** Seconds left on the checkout success countdown (null: none). */
  countdownSeconds?: number | null;
  /** "sub_8F2K…Q1" and "2 min" (stalled hint). */
  reference?: string | null;
  waitedLabel?: string | null;
  /** A forced Dodo lookup is in flight (Check Again). */
  checking?: boolean;
  supportHref: string;
  /** checkout success: the destination; onboarding success: Done. */
  continueHref?: string;
  membershipHref?: string;
  /** checkout failed. */
  tryAgainHref?: string;
  homeHref?: string;
  onCheckAgain?: () => void;
  onSupportClick?: () => void;
  onContinue?: () => void;
  /** Onboarding polling: "Continue in Background" → Done. */
  onContinueInBackground?: () => void;
  onCountdownPause?: () => void;
  onCountdownResume?: () => void;
  /**
   * Default true. False: the card renders no action row; the host draws the actions itself (the onboarding frame
   * puts them in its pinned footer, V3OnbActivating `.ofoot`).
   */
  actions?: boolean;
  className?: string;
};

function IndeterminateBar() {
  return (
    <div
      role="progressbar"
      aria-label="Activation"
      aria-valuetext="Waiting for confirmation"
      className="relative h-1 w-full overflow-hidden bg-cb-border"
      data-testid="activation-bar"
    >
      <span className="absolute inset-y-0 left-0 animate-rc-hair bg-cb-accent motion-reduce:w-[62%] motion-reduce:animate-none" />
    </div>
  );
}

const H1 = "m-0 font-serif text-title font-normal text-balance text-cb-text [overflow-wrap:anywhere] max-[600px]:text-[2rem]";
const BODY = "m-0 text-base text-cb-text-soft max-[600px]:text-body";
const HINT = "m-0 text-xs text-cb-text-soft [@media(max-height:640px)]:hidden";
const ROW = "flex flex-wrap gap-2 max-[600px]:flex-col max-[600px]:[&>*]:w-full";

export function ActivationCard(props: ActivationCardProps) {
  const { kind, phase, isTrial } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const firstPhase = useRef(phase);
  useEffect(() => {
    // Focus follows the state (plan 4.7), but never steals it on the first paint.
    if (firstPhase.current === phase) return;
    firstPhase.current = phase;
    heading.current?.focus();
  }, [phase]);

  const checkout = kind === "checkout";
  let state: React.ReactNode;
  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode = null;
  let hint: React.ReactNode = null;

  if (phase === "polling") {
    state = (
      <span className="inline-flex items-center gap-2 text-overline">
        <Spinner />
        {checkout ? "Checking with Dodo Payments" : "Confirming your card"}
      </span>
    );
    title = isTrial ? "Starting your trial…" : "Activating your membership…";
    body = checkout
      ? isTrial
        ? "Card saved, nothing charged today. This usually takes a few seconds. You can leave this page; we'll finish in the background."
        : "Your payment is being confirmed. This usually takes a few seconds. You can leave this page; we'll finish in the background."
      : isTrial
        ? "Card saved. Nothing is charged today. This usually takes a few seconds."
        : "Your payment is being confirmed. This usually takes a few seconds.";
    if (!checkout && props.onContinueInBackground) {
      actions = (
        <div className={ROW}>
          <Button variant="secondary" onClick={props.onContinueInBackground}>
            Continue in Background
          </Button>
        </div>
      );
    }
  } else if (phase === "stalled") {
    state = (
      <Tag tone="warn" icon={<Clock aria-hidden="true" />} className="self-start">
        Still activating
      </Tag>
    );
    title = "This is taking longer than usual.";
    body = checkout
      ? `Your card was saved, but the confirmation hasn't reached us yet.${isTrial && props.chargeDateLabel ? ` Nothing is charged before ${props.chargeDateLabel}.` : ""} Check again in a moment, or tell us and we'll activate it by hand.`
      : // Not a return from the payment page (D4): nothing says a card was entered, so the copy does not claim it.
        `We haven't heard back from the payment page yet. If you left it before paying, nothing was charged. Check again, or carry on: your ${isTrial ? "trial" : "membership"} starts by itself once it's confirmed.`;
    const checkAgain = (
      <Button
        key="again"
        onClick={props.onCheckAgain}
        loading={props.checking}
        loadingLabel="Checking…"
        iconStart={<RotateCw aria-hidden="true" />}
        data-testid="activation-check-again"
      >
        Check Again
      </Button>
    );
    const support = (
      <Link key="support" href={props.supportHref} onClick={props.onSupportClick} className={buttonVariants({ variant: "secondary" })}>
        {checkout ? "Get Support" : "Contact Support"}
      </Link>
    );
    actions = <div className={ROW}>{checkout ? [checkAgain, support] : [support, checkAgain]}</div>;
    if (checkout && (props.reference || props.waitedLabel)) {
      hint = (
        <p className={HINT}>
          {props.reference ? (
            <>
              Reference <span className="font-mono">{props.reference}</span>
            </>
          ) : null}
          {props.reference && props.waitedLabel ? " · " : null}
          {props.waitedLabel ? `waited ${props.waitedLabel}` : null}
        </p>
      );
    }
  } else if (phase === "success") {
    state = (
      <Tag tone="good" icon={<Check aria-hidden="true" />} className="self-start">
        Active
      </Tag>
    );
    title = props.alreadyMember ? "You're already a member." : isTrial ? "Your free trial has started." : "Your membership is active.";
    if (checkout) {
      const lead = props.alreadyMember
        ? "Your membership is active."
        : isTrial && props.chargeDateLabel
          ? `7 days free, first charge on ${props.chargeDateLabel}.`
          : "Thanks for joining.";
      const tail =
        props.countdownSeconds != null && props.destinationLabel ? (
          <>
            {" "}Taking you back to <span className="font-mono text-cb-text">{props.destinationLabel}</span> in {props.countdownSeconds}{" "}
            {props.countdownSeconds === 1 ? "second" : "seconds"}.
          </>
        ) : props.destinationLabel ? (
          <>
            {" "}Continue to <span className="font-mono text-cb-text">{props.destinationLabel}</span>.
          </>
        ) : null;
      body = (
        <>
          {lead}
          {tail}
        </>
      );
      actions = (
        <div className={ROW}>
          {props.continueHref ? (
            <Link href={props.continueHref} onClick={props.onContinue} className={buttonVariants()} data-testid="activation-continue">
              Continue Now
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
          {props.membershipHref ? (
            <Link href={props.membershipHref} className={buttonVariants({ variant: "secondary" })}>
              See Membership
            </Link>
          ) : null}
        </div>
      );
      if (isTrial && props.trialEndsLabel && props.chargeDateLabel && props.priceLabel && !props.alreadyMember) {
        hint = (
          <p className={HINT}>
            Trial ends {props.trialEndsLabel}; first charge {props.priceLabel} on {props.chargeDateLabel}.
          </p>
        );
      }
    } else {
      // A paid (non-trial) activation must not repeat the title (FIX-1: "Your membership is active." twice).
      body = isTrial && props.chargeDateLabel ? `7 days free. First charge on ${props.chargeDateLabel} unless you cancel before then.` : PAID_SUCCESS_BODY;
      actions = props.continueHref ? (
        <div className={ROW}>
          <Link href={props.continueHref} onClick={props.onContinue} className={buttonVariants()} data-testid="activation-continue">
            Continue
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      ) : null;
    }
  } else {
    state = (
      <Tag tone="bad" icon={<X aria-hidden="true" />} className="self-start">
        Not charged
      </Tag>
    );
    title = "Card wasn't accepted.";
    body = `Your bank declined the card check or checkout was cancelled. Nothing was charged. Your account is saved; finish checkout to start your ${isTrial ? "free trial" : "membership"}.`;
    actions = (
      <div className={ROW}>
        {props.tryAgainHref ? (
          <Link href={props.tryAgainHref} className={buttonVariants()} data-testid="activation-try-again">
            Try Again
          </Link>
        ) : null}
        {props.homeHref ? (
          <Link href={props.homeHref} className={buttonVariants({ variant: "secondary" })}>
            Back to Home
          </Link>
        ) : null}
      </div>
    );
  }

  const countdownActive = phase === "success" && props.countdownSeconds != null;
  return (
    <section
      aria-labelledby="activation-title"
      data-testid="activation-card"
      data-state={phase}
      data-kind={kind}
      onFocusCapture={countdownActive ? props.onCountdownPause : undefined}
      onBlurCapture={countdownActive ? props.onCountdownResume : undefined}
      onPointerEnter={countdownActive ? props.onCountdownPause : undefined}
      onPointerLeave={countdownActive ? props.onCountdownResume : undefined}
      className={cn(
        "flex min-w-0 flex-col justify-center gap-[18px] border border-cb-border bg-cb-surface p-10 text-cb-text",
        "max-[900px]:p-7 max-[600px]:gap-3.5 max-[600px]:p-5 [@media(max-height:640px)]:gap-3 [@media(max-height:640px)]:p-6",
        props.className,
      )}
    >
      <div aria-live="polite" aria-atomic="true" className="flex" data-testid="activation-state-line">
        {state}
      </div>
      <h1 id="activation-title" ref={heading} tabIndex={-1} className={cn(H1, "outline-none")}>
        {title}
      </h1>
      <p className={BODY}>{body}</p>
      {phase === "polling" ? <IndeterminateBar /> : null}
      {props.actions === false ? null : actions}
      {hint}
    </section>
  );
}
