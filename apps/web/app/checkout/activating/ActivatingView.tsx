"use client";

// The /checkout/activating screen (phase-04 plan 4.9; board DR/V3CheckoutActivating, states polling / success /
// stalled / failed). useActivation() runs the poll + socket + machine; this view lays out ActivationCard and the plan
// aside (one column at ≤ 900 px wide) and follows the countdown to the destination.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ActivationData, ActivationQuery } from "@repo/contracts/http/billing";
import { ActivationCard } from "@/components/billing/ActivationCard";
import { PlanSummaryAside } from "@/components/billing/PlanSummaryAside";
import { priceLabel, shortDateLabel, waitedLabel } from "@/lib/billing/activation-copy";
import { countdownSeconds } from "@/lib/billing/activation-machine";
import { eventSourceOf, trackBilling } from "@/lib/billing/telemetry";
import { useActivation } from "@/lib/billing/useActivation";

export type ActivatingViewProps = {
  params: ActivationQuery;
  initial: ActivationData;
  isReturn: boolean;
  source: string | null;
  plan: "monthly" | "yearly" | null;
  destination: string;
  destinationLabel: string;
  timeZone: string;
};

/** Trial or paid: what the member has (entitled), else what this pending checkout offered. */
export function isTrialActivation(data: ActivationData): boolean {
  return data.entitlement.entitled ? data.entitlement.trial.active : data.trial.chargeDate !== null;
}

export function ActivatingView(props: ActivatingViewProps) {
  const router = useRouter();
  const a = useActivation({ kind: "checkout", params: props.params, initial: props.initial, isReturn: props.isReturn, source: props.source });
  const { state, data } = a;

  useEffect(() => {
    if (state.navigate) router.replace(props.destination);
  }, [state.navigate, router, props.destination]);

  const isTrial = isTrialActivation(data);
  const chargeDateLabel = shortDateLabel(data.trial.chargeDate ?? data.trial.endsAt, props.timeZone);
  const trialEndsLabel = data.trial.endsAt ? shortDateLabel(new Date(Date.parse(data.trial.endsAt) - 86_400_000), props.timeZone) : null;
  const interval = data.plan?.interval ?? (props.plan === "yearly" ? "year" : "month");
  const price = priceLabel(interval, data.plan?.priceCents ?? null).price;
  const plan = props.plan ?? (data.plan?.interval === "year" ? "yearly" : data.plan ? "monthly" : null);
  const source = eventSourceOf(props.source);

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto px-8 py-6 max-[600px]:px-4 max-[600px]:py-4 [@media(max-height:640px)]:py-3">
      <div className="m-auto grid w-[min(1000px,100%)] grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-stretch gap-6 max-[900px]:grid-cols-1 max-[600px]:gap-3">
        <ActivationCard
          kind="checkout"
          phase={state.phase}
          isTrial={isTrial}
          alreadyMember={state.alreadyMember}
          chargeDateLabel={chargeDateLabel}
          trialEndsLabel={trialEndsLabel}
          priceLabel={price}
          destinationLabel={props.destinationLabel}
          countdownSeconds={countdownSeconds(state)}
          reference={data.reference}
          waitedLabel={waitedLabel(data.waitedMs)}
          checking={a.checking}
          supportHref={`/contact?topic=billing${data.reference ? `&ref=${encodeURIComponent(data.reference)}` : ""}`}
          continueHref={props.destination}
          membershipHref="/pricing"
          tryAgainHref={`/pricing?checkout=failed${plan ? `&plan=${plan}` : ""}`}
          homeHref="/"
          onCheckAgain={a.checkAgain}
          onSupportClick={() => trackBilling("checkout_support_clicked", { source })}
          onCountdownPause={a.pauseCountdown}
          onCountdownResume={a.resumeCountdown}
        />
        <PlanSummaryAside
          isTrial={isTrial}
          interval={interval}
          priceCents={data.plan?.priceCents ?? null}
          chargeDateLabel={chargeDateLabel}
          renewsLabel={data.entitlement.entitled && !isTrial ? shortDateLabel(data.entitlement.currentPeriodEnd, props.timeZone) : null}
          destinationLabel={props.destinationLabel}
          showReturn={state.phase === "polling" || state.phase === "stalled"}
        />
      </div>
    </main>
  );
}
