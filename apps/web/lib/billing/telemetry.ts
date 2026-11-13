// Billing client telemetry (phase-04 plan 10.1). The events are declared in `@repo/analytics/events/billing`; this
// module imports TYPES only, so zod never reaches the activating or pricing chunks. Same rules as trackGame(): the test
// sink first, PostHog only when loaded and not on a `/dev/**` demo route, never throws.
import type { billingClientEvents } from "@repo/analytics/events/billing";
import type { z } from "zod";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";

type ClientEvents = typeof billingClientEvents;
export type BillingClientEventName = keyof ClientEvents;
export type BillingClientEventProps<N extends BillingClientEventName> = z.infer<ClientEvents[N]>;

export function trackBilling<N extends BillingClientEventName>(name: N, props: BillingClientEventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks checkout.
  }
}

/** The checkout source of an activation URL's `source` parameter (`unknown` for a legacy or hand-made URL). */
export function eventSourceOf(raw: string | null | undefined): BillingClientEventProps<"checkout_returned">["source"] {
  return raw === "pricing" || raw === "onboarding" || raw === "paywall" || raw === "renew" ? raw : "unknown";
}

const STATUS_PARAMS = ["active", "succeeded", "failed", "cancelled", "pending"] as const;

/** Dodo's `status` return parameter folded to the event's closed set (analytics events/billing checkoutStatusParam). */
export function statusParamOf(raw: string | null | undefined): BillingClientEventProps<"checkout_returned">["status_param"] {
  if (!raw) return "none";
  const v = raw.trim().toLowerCase();
  return (STATUS_PARAMS as readonly string[]).includes(v) ? (v as (typeof STATUS_PARAMS)[number]) : "other";
}
