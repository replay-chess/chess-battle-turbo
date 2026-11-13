import { defineEndpoint } from "../endpoint";
import { ACTIVATION_LIMIT, ActivationData, ActivationQuery, CHECKOUT_LIMIT, CheckoutBody, CheckoutData } from "../billing";

/**
 * Phase-04 plan §7.0 BIL-1, BIL-2, §7.5, §8.5. Handlers: WEB/app/api/checkout/route.ts (reworked onto route()) and
 * WEB/app/api/billing/activation/route.ts (WP-D). A separate area from P1's billing.ts so P4 adds a file only.
 */
export const activationEndpoints = {
  /**
   * BIL-1. Idempotency-Key required (a replay returns the same checkoutUrl). Email from the DB row; the trial through
   * `trialOfferedAt` + the ledger; `source: onboarding` moves the step to ACTIVATING in the same UPDATE.
   */
  checkout: defineEndpoint({
    id: "billing.checkout",
    method: "POST",
    path: "/api/checkout",
    auth: "user",
    class: "X",
    cache: "no-store",
    rateLimit: CHECKOUT_LIMIT,
    body: CheckoutBody,
    response: CheckoutData,
    errors: ["already_subscribed", "payment_update_required", "upstream_unavailable", "not_configured", "idempotency_key_reused"],
    maxBodyBytes: 2_048,
    summary: "Opens a hosted checkout (with the 7-day trial when eligible)",
  }),
  /**
   * BIL-2. Polled. DB first; asks Dodo (DODO_ACTIVATION_LIMIT, at most once per 5 s) only after 6 s or on
   * `force=1`, and writes only through P1's billing compare-and-set (`billing_snapshot`). Sets `rc_act` on the
   * first `active` (D4-29).
   */
  activation: defineEndpoint({
    id: "billing.activation",
    method: "GET",
    path: "/api/billing/activation",
    auth: "user",
    class: "R1",
    cache: "no-store",
    sideEffects: ["billing_snapshot"],
    rateLimit: ACTIVATION_LIMIT,
    query: ActivationQuery,
    response: ActivationData,
    errors: ["upstream_unavailable", "not_configured"],
    summary: "Whether the viewer's checkout has activated their membership",
  }),
} as const;
