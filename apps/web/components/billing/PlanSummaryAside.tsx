// PlanSummaryAside (phase-04 plan 4.9; board DR/V3CheckoutActivating `aside[aria-label="Your trial"]`): the plan the
// checkout is activating, with the return hint while it waits. Server-renderable (no state, no handlers).
import { Check } from "lucide-react";
import { Overline } from "@/components/ui/divider";
import { PLAN_NAME } from "@/lib/billing/plans";
import { ACTIVATION_FEATURES, priceLabel } from "@/lib/billing/activation-copy";
import { cn } from "@/lib/utils";

export type PlanSummaryAsideProps = {
  isTrial: boolean;
  interval: "month" | "year";
  /** Legacy members keep their price; null = the catalogue price. */
  priceCents?: number | null;
  /** "6 Nov": when the paid period starts (trial) or null. */
  chargeDateLabel: string | null;
  /** "5 Dec": an active paid membership's next renewal (instead of "from today"). */
  renewsLabel?: string | null;
  /** "Play" etc.; shown while the page is still waiting (`showReturn`). */
  destinationLabel?: string | null;
  showReturn: boolean;
  className?: string;
};

export function PlanSummaryAside({ isTrial, interval, priceCents, chargeDateLabel, renewsLabel, destinationLabel, showReturn, className }: PlanSummaryAsideProps) {
  const { price, per } = priceLabel(interval, priceCents);
  const cadence = per === "year" ? "yearly" : "monthly";
  const terms = isTrial
    ? `7 days free · then ${cadence} from ${chargeDateLabel ?? "day 8"}`
    : renewsLabel
      ? `Billed ${cadence} · renews ${renewsLabel}`
      : `Billed ${cadence} from today`;
  return (
    <aside
      aria-label={isTrial ? "Your trial" : "Your membership"}
      data-testid="plan-summary-aside"
      className={cn("flex min-w-0 flex-col gap-3.5 border border-cb-border bg-cb-surface p-8 text-sm text-cb-text max-[900px]:p-6 max-[600px]:p-5", className)}
    >
      <Overline>{isTrial ? "Your trial" : "Your membership"}</Overline>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-[2.25rem] leading-none">{PLAN_NAME}</span>
        <span>
          <span className="font-serif text-[2.25rem] leading-none">{price}</span>
          <span className="text-cb-text-soft"> / {per}</span>
        </span>
      </div>
      <span className="-mt-1.5 text-cb-text-soft">{terms}</span>
      <ul className="m-0 mt-1 flex list-none flex-col p-0 [@media(max-height:640px)]:hidden">
        {ACTIVATION_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 border-t border-cb-border py-2.5">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      {showReturn && destinationLabel ? (
        <p className="m-0 mt-auto border-t border-cb-border pt-3 text-ui text-cb-text-soft" data-testid="plan-summary-return">
          You&apos;ll return to <span className="font-mono text-cb-text">{destinationLabel}</span> when this finishes.
        </p>
      ) : null}
    </aside>
  );
}
