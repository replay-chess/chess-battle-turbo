// The Dodo REST calls of phase 4 (checkout, activation self-heal, the webhook's duplicate-trial guard), behind one
// small interface so routes and the DAL are tested with a fake (setDodoApi) and never reach Dodo in CI (D4-19).
//
//   getDodoApi()  → null when DODO_PAYMENTS_API_KEY is unset (callers answer 503 not_configured)
//
// Every call has a 5 s timeout and one retry (refresh.ts DODO_TIMEOUT_MS / DODO_MAX_RETRIES: a polled GET never waits
// on the SDK's 60 s default). The base URL is the SDK's own for DODO_PAYMENTS_ENVIRONMENT (test_mode unless
// "live_mode"), or DODO_API_BASE_URL in a test build only (dodo-env.ts; refused, i.e. thrown, anywhere else). The SDK
// loads lazily so route modules stay importable by the contract tests.
import type { SubscriptionSnapshot } from "./entitlement-rules";
import { dodoApiBaseUrl } from "./dodo-env";
import { DODO_MAX_RETRIES, DODO_TIMEOUT_MS, MAX_SUBSCRIPTIONS } from "./refresh";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The checkout create's own timeout (D3). The first "Start 7-day free trial" of a fresh user failed with "Couldn't
 * open checkout. Nothing was charged." and the retry worked: Dodo's first session of a new customer (a customer record
 * is created with it) took longer than the 5 s polled-GET budget, so both attempts timed out (≈ 10 s) and the route
 * answered 502. The create is a click the member waits on, not a poll: 12 s, one retry, inside the route's
 * maxDuration 30 (app/api/checkout/route.ts).
 */
export const CHECKOUT_CREATE_TIMEOUT_MS = 12_000;

export type CheckoutSessionInput = {
  productId: string;
  /** An existing Dodo customer, else the email and name from the users row (never from the request). */
  customer: { customerId: string } | { email: string; name?: string };
  metadata: Record<string, string>;
  trialDays: number | null;
  returnUrl: string;
  theme: "dark" | "light" | "system";
};

/** A subscription read by id, with the fields the activation ownership check and the CAS need. */
export type DodoSubscription = SubscriptionSnapshot & {
  metadata?: Record<string, string> | null;
  updated_at?: string | null;
};

export interface DodoApi {
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ sessionId: string; checkoutUrl: string }>;
  /** The customer's subscriptions (bounded by MAX_SUBSCRIPTIONS). */
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  retrieveSubscription(subscriptionId: string): Promise<DodoSubscription>;
  /** `payment_status` of a checkout session (null while the customer is still on the details step). */
  retrieveCheckoutSession(sessionId: string): Promise<{ paymentStatus: string | null }>;
  /** Plan 8.4.5: the duplicate trial ends at its trial end without a charge. Idempotent at Dodo. */
  cancelAtNextBillingDate(subscriptionId: string): Promise<void>;
}

/** Thrown when Dodo answered without the field the caller needs (e.g. a session without a checkout URL). */
export class DodoResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DodoResponseError";
  }
}

/** `details.kind` of a 502 upstream_unavailable from a Dodo failure (D4-05). */
export function dodoErrorKind(err: unknown): "timeout" | "error" {
  const name = err instanceof Error ? err.name : "";
  return /timeout/i.test(name) || (err as { code?: unknown })?.code === "ETIMEDOUT" ? "timeout" : "error";
}

let override: DodoApi | null | undefined;

/** Test seam (contract, unit and integration tests); returns a restore function. */
export function setDodoApi(api: DodoApi | null): () => void {
  const previous = override;
  override = api;
  return () => {
    override = previous;
  };
}

/** The Dodo API, or null without DODO_PAYMENTS_API_KEY. Throws DodoBaseUrlRefusedError on a refused override. */
export async function getDodoApi(env: Env = process.env): Promise<DodoApi | null> {
  if (override !== undefined) return override;
  const key = env.DODO_PAYMENTS_API_KEY?.trim();
  if (!key) return null;
  const baseURL = dodoApiBaseUrl(env);
  const { default: DodoPayments } = await import("dodopayments");
  // The SDK refuses `environment` together with `baseURL` ("Ambiguous URL"): the override replaces the environment.
  const client = new DodoPayments({
    bearerToken: key,
    ...(baseURL ? { baseURL } : { environment: env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" ? "live_mode" : "test_mode" }),
    timeout: DODO_TIMEOUT_MS,
    maxRetries: DODO_MAX_RETRIES,
  });
  return {
    async createCheckoutSession(input) {
      const session = await client.checkoutSessions.create({
        product_cart: [{ product_id: input.productId, quantity: 1 }],
        customer: "customerId" in input.customer ? { customer_id: input.customer.customerId } : { email: input.customer.email, name: input.customer.name },
        metadata: input.metadata,
        ...(input.trialDays ? { subscription_data: { trial_period_days: input.trialDays } } : {}),
        return_url: input.returnUrl,
        customization: { theme: input.theme, show_order_details: true },
        // Land straight back in the app (the activating page confirms activation itself).
        feature_flags: { redirect_immediately: true, allow_discount_code: true },
      }, { timeout: CHECKOUT_CREATE_TIMEOUT_MS, maxRetries: DODO_MAX_RETRIES });
      if (!session.checkout_url) throw new DodoResponseError("checkout session without a checkout_url");
      return { sessionId: session.session_id, checkoutUrl: session.checkout_url };
    },
    async listSubscriptions(customerId) {
      const out: SubscriptionSnapshot[] = [];
      for await (const subscription of client.subscriptions.list({ customer_id: customerId })) {
        out.push(subscription);
        if (out.length >= MAX_SUBSCRIPTIONS) break;
      }
      return out;
    },
    async retrieveSubscription(subscriptionId) {
      const sub = await client.subscriptions.retrieve(subscriptionId);
      return sub as DodoSubscription;
    },
    async retrieveCheckoutSession(sessionId) {
      const status = await client.checkoutSessions.retrieve(sessionId);
      return { paymentStatus: status.payment_status ?? null };
    },
    async cancelAtNextBillingDate(subscriptionId) {
      await client.subscriptions.update(subscriptionId, { cancel_at_next_billing_date: true });
    },
  };
}
