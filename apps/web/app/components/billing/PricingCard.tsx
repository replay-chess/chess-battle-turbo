"use client";

import { Check, Loader2 } from "lucide-react";
import {
  BILLING_PLANS,
  PLAN_NAME,
  formatPrice,
  monthlyEquivalentCents,
  type PlanKey,
} from "@/lib/billing/plans";
import { MONEY_BACK_COPY, PLAN_FEATURES } from "@/lib/billing/copy";

const YEARLY_PRICE = formatPrice(BILLING_PLANS.yearly.priceCents);
const YEARLY_PER_MONTH = formatPrice(monthlyEquivalentCents(BILLING_PLANS.yearly));

export function PricingCard({
  plan,
  onSubscribe,
  loading,
  error,
  isSignedIn,
  ctaLabel,
  note,
  compact,
}: {
  plan: PlanKey;
  onSubscribe: () => void;
  loading?: boolean;
  error?: string | null;
  isSignedIn: boolean;
  ctaLabel?: string;
  note?: string;
  compact?: boolean;
}) {
  const selected = BILLING_PLANS[plan];
  const label =
    ctaLabel ??
    (isSignedIn ? `Subscribe ${selected.label.toLowerCase()}` : "Sign in to subscribe");
  const billingNote =
    plan === "yearly"
      ? `That's ${YEARLY_PER_MONTH} a month, billed ${YEARLY_PRICE} once a year.`
      : selected.billingNote;

  return (
    <div
      className={`border border-cb-border bg-cb-hover ${compact ? "p-6" : "p-8"}`}
      data-testid="pricing-card"
    >
      <div className="flex items-center justify-between mb-4">
        <h3
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-sm font-medium text-cb-text-secondary uppercase tracking-widest"
        >
          {PLAN_NAME}
        </h3>
        <span
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="text-[10px] uppercase tracking-widest text-cb-text-muted"
        >
          {selected.label}
        </span>
      </div>
      <p
        style={{ fontFamily: "'Instrument Serif', serif" }}
        className={`text-cb-text mb-2 ${compact ? "text-4xl" : "text-5xl"}`}
        data-testid="pricing-amount"
      >
        {formatPrice(selected.priceCents)}
        <span className="text-lg text-cb-text-muted">{selected.periodLabel}</span>
      </p>
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="text-sm text-cb-text-muted mb-1"
      >
        {billingNote}
      </p>
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className={`text-sm text-cb-text-muted ${compact ? "mb-5" : "mb-8"}`}
      >
        {note ?? "For casual players and learners"}
      </p>
      <ul
        className={`text-sm text-cb-text-muted ${compact ? "space-y-2 mb-5" : "space-y-3 mb-8"}`}
        style={{ fontFamily: "'Geist', sans-serif" }}
      >
        {PLAN_FEATURES.map((feature) => (
          <li key={feature} className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-cb-text-muted" />
            {feature}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSubscribe}
        disabled={loading}
        data-testid="pricing-subscribe"
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="w-full py-3 text-sm font-medium text-cb-accent-fg bg-cb-accent hover:bg-cb-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : label}
      </button>
      {error && (
        <p
          role="alert"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="mt-3 text-xs text-red-400 text-center"
        >
          {error}
        </p>
      )}
      <p
        style={{ fontFamily: "'Geist', sans-serif" }}
        className="mt-4 text-[11px] text-cb-text-muted text-center"
      >
        {MONEY_BACK_COPY}
      </p>
    </div>
  );
}
