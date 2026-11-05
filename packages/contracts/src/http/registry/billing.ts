import { defineEndpoint } from "../endpoint";
import { BillingRefreshData, LegacySubscriptionResponse } from "../billing";

export const billingEndpoints = {
  /** A19. Pulls the subscription from Dodo and applies it with the compare-and-set. */
  refresh: defineEndpoint({
    id: "billing.refresh",
    method: "POST",
    path: "/api/billing/refresh",
    auth: "user",
    class: "X",
    cache: "no-store",
    rateLimit: { bucket: "billing-refresh", limit: 10, windowSec: 60, by: "user" },
    response: BillingRefreshData,
    errors: ["not_configured"],
    summary: "Re-reads the membership from the billing provider",
  }),
  /** A6. Legacy handler (not route() yet): DB-only, legacy body, errors in the envelope. */
  subscriptionGet: defineEndpoint({
    id: "subscription.get",
    method: "GET",
    path: "/api/subscription",
    auth: "user",
    class: "R1",
    cache: "no-store",
    response: LegacySubscriptionResponse,
    responseFormat: "legacy",
    deprecated: true,
    summary: "Legacy subscription summary (SubscriptionResponse)",
  }),
} as const;
