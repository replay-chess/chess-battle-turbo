"use client";

import { BILLING_PLANS, PLAN_KEYS, yearlySavings, type PlanKey } from "@/lib/billing/plans";

const SAVINGS = yearlySavings();

export function BillingToggle({
  value,
  onChange,
  className,
}: {
  value: PlanKey;
  onChange: (plan: PlanKey) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      data-testid="billing-toggle"
      className={`inline-flex border border-cb-border bg-cb-hover p-1 ${className ?? ""}`}
    >
      {PLAN_KEYS.map((key) => {
        const plan = BILLING_PLANS[key];
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`billing-option-${key}`}
            onClick={() => onChange(key)}
            style={{ fontFamily: "'Geist', sans-serif" }}
            className={`px-5 py-2 text-sm transition-colors flex items-center gap-2 ${
              active
                ? "bg-cb-accent text-cb-accent-fg"
                : "text-cb-text-muted hover:text-cb-text"
            }`}
          >
            {plan.label}
            {key === "yearly" && (
              <span
                className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 border ${
                  active
                    ? "border-cb-accent-fg/40"
                    : "border-amber-500/40 text-amber-400"
                }`}
              >
                Save {SAVINGS.percent}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
