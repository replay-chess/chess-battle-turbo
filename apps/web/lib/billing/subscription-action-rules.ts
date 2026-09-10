/**
 * Pure rules for self-service subscription changes (upgrade, downgrade,
 * cancel, resume). No network or database access, so the module can be used
 * from the client, the API routes, and unit tests alike. The server-only
 * wrapper in `subscription-actions.ts` applies these rules to Dodo calls.
 */
import type { StoreSubscription } from "@/lib/stores/useUserStore";
import type { EntitlementSummary } from "./entitlement-rules";
import { BILLING_PLANS, type PlanKey } from "./plans";

/** Plan keys as stored on the entitlement summary. */
export type CurrentPlanKey = PlanKey | "legacy" | null;

/** Dodo's cancellation feedback values, mirrored from the SDK. */
export const CANCELLATION_FEEDBACK_VALUES = [
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
] as const;

export type CancellationFeedbackValue = (typeof CANCELLATION_FEEDBACK_VALUES)[number];

/** Labels for the cancellation reason select. */
export const CANCELLATION_FEEDBACK_LABELS: Record<CancellationFeedbackValue, string> = {
  too_expensive: "Too expensive",
  missing_features: "Missing features I need",
  switched_service: "Switched to another service",
  unused: "I don't use it enough",
  customer_service: "Customer service",
  low_quality: "Quality was not what I expected",
  too_complex: "Too complicated",
  other: "Other",
};

export function normalizeCancellationFeedback(
  value: unknown,
): CancellationFeedbackValue | undefined {
  return typeof value === "string" &&
    (CANCELLATION_FEEDBACK_VALUES as readonly string[]).includes(value)
    ? (value as CancellationFeedbackValue)
    : undefined;
}

/** A change from one plan to another, with the Dodo parameters it needs. */
export interface PlanChange {
  target: PlanKey;
  /** Upgrades apply now with proration; downgrades wait for the renewal date. */
  kind: "upgrade" | "downgrade";
  effectiveAt: "immediately" | "next_billing_date";
  prorationBillingMode: "prorated_immediately" | "do_not_bill";
}

export interface PlanChangeRejection {
  status: 409;
  code: "same_plan" | "not_active";
  message: string;
}

const UPGRADE: Omit<PlanChange, "target"> = {
  kind: "upgrade",
  effectiveAt: "immediately",
  prorationBillingMode: "prorated_immediately",
};

const DOWNGRADE: Omit<PlanChange, "target"> = {
  kind: "downgrade",
  effectiveAt: "next_billing_date",
  prorationBillingMode: "do_not_bill",
};

/**
 * The plan changes a member on `current` may make.
 *
 * - monthly -> yearly is an upgrade (charged now, prorated)
 * - yearly -> monthly is a downgrade (applies at renewal, nothing billed)
 * - legacy ($8/mo) -> either new product is treated as an upgrade so the
 *   member moves to the cheaper price right away
 */
export function availablePlanChanges(current: CurrentPlanKey): PlanChange[] {
  switch (current) {
    case "monthly":
      return [{ target: "yearly", ...UPGRADE }];
    case "yearly":
      return [{ target: "monthly", ...DOWNGRADE }];
    case "legacy":
      return [
        { target: "yearly", ...UPGRADE },
        { target: "monthly", ...UPGRADE },
      ];
    default:
      return [];
  }
}

/**
 * Decides how (or whether) to move a subscription to `target`. Only an active
 * subscription can change plans; a paused, on-hold or cancelling one must be
 * fixed or resumed first.
 */
export function decidePlanChange(
  current: CurrentPlanKey,
  status: string | null | undefined,
  target: PlanKey,
): PlanChange | PlanChangeRejection {
  if (current === target) {
    return {
      status: 409,
      code: "same_plan",
      message: `You are already on the ${BILLING_PLANS[target].label.toLowerCase()} plan.`,
    };
  }
  if (status !== "active") {
    return {
      status: 409,
      code: "not_active",
      message:
        status === "on_hold" || status === "past_due"
          ? "Your last payment did not go through. Update your payment method before changing plans."
          : "Only an active subscription can change plans.",
    };
  }
  const change = availablePlanChanges(current).find((option) => option.target === target);
  // A subscription on an unknown product is treated like an upgrade so the
  // member lands on a current product immediately.
  return change ?? { target, ...UPGRADE };
}

export function isPlanChangeRejection(
  value: PlanChange | PlanChangeRejection,
): value is PlanChangeRejection {
  return "status" in value;
}

/** Whether a subscription can still be cancelled at the end of its period. */
export function cancellationRejection(
  status: string | null | undefined,
  cancelAtPeriodEnd: boolean,
): { status: 409; message: string } | null {
  if (cancelAtPeriodEnd) {
    return { status: 409, message: "Your subscription is already set to cancel." };
  }
  if (status === "cancelled" || status === "expired" || status === "failed") {
    return { status: 409, message: "This subscription has already ended." };
  }
  return null;
}

/** Whether a scheduled cancellation can be undone. */
export function resumeRejection(
  status: string | null | undefined,
  cancelAtPeriodEnd: boolean,
): { status: 409; message: string } | null {
  if (status === "cancelled" || status === "expired" || status === "failed") {
    return {
      status: 409,
      message: "This subscription has already ended. Start a new plan from the pricing page.",
    };
  }
  if (!cancelAtPeriodEnd) {
    return { status: 409, message: "Your subscription is not scheduled to cancel." };
  }
  return null;
}

/** One line of a plan-change preview, flattened for the client. */
export interface PreviewLineItem {
  type: string;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unitPriceCents: number | null;
  prorationFactor: number | null;
  taxCents: number | null;
}

/** What the upgrade modal shows before the member confirms. */
export interface PlanChangePreview {
  /** Amount charged right now, in minor units (cents for USD). */
  immediateChargeCents: number | null;
  currency: string | null;
  taxCents: number | null;
  customerCreditsCents: number | null;
  effectiveAt: string | null;
  lineItems: PreviewLineItem[];
  newPlan: {
    productId: string | null;
    planKey: CurrentPlanKey;
    interval: "month" | "year" | null;
    priceCents: number | null;
    nextBillingDate: string | null;
    status: string | null;
  };
}

/** Loose shape of the SDK preview response, so the mapper tolerates gaps. */
export interface RawPreviewResponse {
  immediate_charge?: {
    effective_at?: string | null;
    line_items?: ReadonlyArray<object> | null;
    summary?: {
      currency?: string | null;
      total_amount?: number | null;
      tax?: number | null;
      customer_credits?: number | null;
    } | null;
  } | null;
  new_plan?: {
    product_id?: string | null;
    next_billing_date?: string | null;
    status?: string | null;
  } | null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function mapPlanChangePreview(
  raw: RawPreviewResponse,
  resolveProduct: (productId: string | null) => {
    planKey: CurrentPlanKey;
    interval: "month" | "year" | null;
    priceCents: number | null;
  },
): PlanChangePreview {
  const charge = raw.immediate_charge ?? null;
  const summary = charge?.summary ?? null;
  const productId = stringOrNull(raw.new_plan?.product_id);
  const resolved = resolveProduct(productId);

  return {
    immediateChargeCents: numberOrNull(summary?.total_amount),
    currency: stringOrNull(summary?.currency),
    taxCents: numberOrNull(summary?.tax),
    customerCreditsCents: numberOrNull(summary?.customer_credits),
    effectiveAt: stringOrNull(charge?.effective_at),
    lineItems: (charge?.line_items ?? []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        type: stringOrNull(item.type) ?? "unknown",
        name: stringOrNull(item.name),
        description: stringOrNull(item.description),
        quantity: numberOrNull(item.quantity),
        unitPriceCents: numberOrNull(item.unit_price),
        prorationFactor: numberOrNull(item.proration_factor),
        taxCents: numberOrNull(item.tax),
      };
    }),
    newPlan: {
      productId,
      planKey: resolved.planKey,
      interval: resolved.interval,
      priceCents: resolved.priceCents,
      nextBillingDate: stringOrNull(raw.new_plan?.next_billing_date),
      status: stringOrNull(raw.new_plan?.status),
    },
  };
}

/** Formats a minor-unit amount in the given currency, e.g. "$12.34". */
export function formatMinorUnits(amount: number, currency: string | null): string {
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(
      amount / 100,
    );
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

/** Formats an ISO timestamp as "Sep 10, 2026". Returns "—" for bad input. */
export function formatMembershipDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Folds the entitlement a membership route returned into the user store's
 * subscription shape, keeping fields the summary does not carry (customer ID,
 * product ID, paywall flag) from what is already stored.
 */
export function mergeEntitlementIntoStore(
  current: StoreSubscription | null,
  entitlement: EntitlementSummary,
): StoreSubscription {
  const nested =
    entitlement.subscriptionId && entitlement.status
      ? {
          id: entitlement.subscriptionId,
          status: entitlement.status,
          productId: current?.subscription?.productId ?? "",
          nextBillingDate: entitlement.currentPeriodEnd ?? "",
          planKey: entitlement.planKey,
          interval: entitlement.interval,
          priceCents: entitlement.priceCents,
        }
      : undefined;

  return {
    ...current,
    plan: entitlement.plan,
    entitled: entitlement.entitled,
    status: entitlement.status,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    subscriptionId: entitlement.subscriptionId,
    subscription: nested,
  };
}
