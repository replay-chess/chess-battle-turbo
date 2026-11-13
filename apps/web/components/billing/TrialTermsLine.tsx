// TrialTermsLine (phase-04 plan 4.6; board DR/V3OnbPlan): the line under the plan step's Start button. With a trial:
// "Then $4.99/month. Cancel before 6 Nov and you won't be charged." (the date rendered on the server in the viewer's
// time zone, today + TRIAL_DAYS); trial used: "Billed $4.99 today, then monthly. Cancel any time." Server-renderable.
import { shortDateLabel, trialChargeDateFrom, trialTermsText } from "@/lib/billing/activation-copy";
import { cn } from "@/lib/utils";

export type TrialTermsLineProps = {
  trial: boolean;
  interval: "month" | "year";
  /** The authoritative charge date once known (CheckoutData.chargeDate); default today + 7 days. */
  chargeDate?: string | Date | null;
  /** The viewer's IANA zone (`users."timeZone"`). */
  timeZone?: string;
  /** The request clock (`requestNow()`), so e2e's x-rc-now moves the date too. */
  now?: Date;
  priceCents?: number | null;
  className?: string;
};

export function TrialTermsLine({ trial, interval, chargeDate, timeZone = "UTC", now, priceCents, className }: TrialTermsLineProps) {
  const date = chargeDate ?? trialChargeDateFrom(now ?? new Date());
  const text = trialTermsText({ trial, interval, chargeDateLabel: shortDateLabel(date, timeZone), priceCents });
  return (
    <p className={cn("m-0 text-xs text-cb-text-soft", className)} data-testid="trial-terms-line">
      {text}
    </p>
  );
}
