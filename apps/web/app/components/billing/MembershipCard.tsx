"use client";

import { ArrowRight, CreditCard, LifeBuoy } from "lucide-react";
import { PLAN_NAME, describePlanPrice } from "@/lib/billing/plans";
import { SUPPORT_EMAIL, formatBillingDate } from "@/lib/billing/copy";
import type { StoreSubscription } from "@/lib/stores/useUserStore";

type Badge = { label: string; tone: "active" | "warning" };

function badgeFor(subscription: StoreSubscription | null): Badge {
  const status = subscription?.subscription?.status ?? subscription?.status ?? null;
  // Dodo keeps a period-end cancellation `active`; a subscription that is
  // already `cancelled` without a scheduled cancel was ended immediately.
  if (status === "cancelled" && !subscription?.cancelAtPeriodEnd) {
    return { label: "Ended", tone: "warning" };
  }
  if (status === "expired" || status === "failed") {
    return { label: "Ended", tone: "warning" };
  }
  if (subscription?.cancelAtPeriodEnd || status === "cancelled") {
    return { label: "Cancelling", tone: "warning" };
  }
  if (status === "on_hold" || status === "past_due" || status === "paused") {
    return { label: "On hold", tone: "warning" };
  }
  return { label: "Active", tone: "active" };
}

function humanizeStatus(status: string | null | undefined): string {
  if (!status) return "Active";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function MembershipCard({
  subscription,
  compact,
}: {
  subscription: StoreSubscription | null;
  /** No longer needed: the portal route resolves the customer server-side. */
  customerId?: string;
  compact?: boolean;
}) {
  const details = subscription?.subscription;
  const badge = badgeFor(subscription);
  const priceLabel =
    details?.priceCents && details.interval
      ? describePlanPrice({ interval: details.interval, priceCents: details.priceCents })
      : null;
  const periodEnd = details?.nextBillingDate ?? subscription?.currentPeriodEnd ?? null;
  const ended = badge.label === "Ended";
  // An immediate cancel still carries a future next_billing_date, so never
  // present that date as an access date once the plan has ended.
  const dateLabel = ended ? "Access" : badge.label === "Cancelling" ? "Access until" : "Renews on";
  const dateValue = ended ? "Ended" : periodEnd ? formatBillingDate(periodEnd) : "—";
  // The portal route resolves the customer from the signed-in user itself.
  const portalHref = "/api/customer-portal";

  return (
    <div data-testid="membership-card">
      <div className="border border-cb-border bg-cb-hover">
        <div className={compact ? "p-6" : "p-8"}>
          <div className="flex items-center gap-3 mb-6">
            <span className="relative flex h-2.5 w-2.5">
              {badge.tone === "active" && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  badge.tone === "active" ? "bg-amber-500" : "bg-cb-text-muted"
                }`}
              />
            </span>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              data-testid="membership-badge"
              className={`text-xs font-medium uppercase tracking-widest ${
                badge.tone === "active" ? "text-amber-400" : "text-cb-text-secondary"
              }`}
            >
              {badge.label}
            </span>
          </div>
          <h2
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className={`text-cb-text mb-2 ${compact ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"}`}
          >
            {PLAN_NAME}
          </h2>
          {priceLabel && (
            <p
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-2xl text-cb-text-secondary"
              data-testid="membership-price"
            >
              {priceLabel}
            </p>
          )}
          {details?.interval && (
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs text-cb-text-muted mt-2"
            >
              {details.interval === "year" ? "Billed yearly" : "Billed monthly"}
            </p>
          )}
        </div>

        {/* Status strip */}
        <div className="grid grid-cols-2 gap-px bg-cb-hover">
          <div className="bg-cb-bg p-5">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
            >
              {dateLabel}
            </p>
            <p
              style={{ fontFamily: "'Geist Mono', monospace" }}
              className="text-sm text-cb-text-secondary"
              data-testid="membership-period-end"
            >
              {dateValue}
            </p>
          </div>
          <div className="bg-cb-bg p-5">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] tracking-[0.3em] uppercase text-cb-text-muted mb-2"
            >
              Status
            </p>
            <p
              style={{ fontFamily: "'Geist Mono', monospace" }}
              className={`text-sm ${badge.tone === "active" ? "text-amber-400" : "text-cb-text-secondary"}`}
              data-testid="membership-status"
            >
              {humanizeStatus(details?.status ?? subscription?.status)}
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${compact ? "mt-4" : "mt-8"}`}>
        <a
          href={portalHref}
          data-testid="manage-billing"
          className="group border border-cb-border bg-cb-hover hover:bg-cb-hover transition-colors p-6 flex flex-col"
        >
          <div className="flex items-center justify-between mb-3">
            <CreditCard className="w-5 h-5 text-cb-text-muted" />
            <ArrowRight className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted transition-colors" />
          </div>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-sm font-medium text-cb-text mb-1"
          >
            Manage Billing
          </p>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-xs text-cb-text-muted"
          >
            Update payment, view invoices, cancel
          </p>
        </a>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="group border border-cb-border bg-cb-hover hover:bg-cb-hover transition-colors p-6 flex flex-col"
        >
          <div className="flex items-center justify-between mb-3">
            <LifeBuoy className="w-5 h-5 text-cb-text-muted" />
            <ArrowRight className="w-4 h-4 text-cb-text-faint group-hover:text-cb-text-muted transition-colors" />
          </div>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-sm font-medium text-cb-text mb-1"
          >
            Get Support
          </p>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-xs text-cb-text-muted"
          >
            Help with subscription or features
          </p>
        </a>
      </div>
    </div>
  );
}
