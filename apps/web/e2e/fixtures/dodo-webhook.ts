// Signed Dodo webhooks for the e2e specs (phase-04 plan §12.4 "Infrastructure"; D4-19).
//
// Builds the four events the P4 flows need and POSTs them to the app's /api/webhook/dodo-payments, signed with
// `standardwebhooks` and DODO_PAYMENTS_WEBHOOK_KEY (the same key the web server under test verifies with: .env.test
// locally, a random per-run key in CI). Against a deployed site the key differs, so specs that use this are
// `@local-only`.
//
//   const sub = trialSubscription({ clerkUserId, customerId, email, productId });
//   expect((await sendDodoWebhook(request, "subscription.active", sub)).status).toBe(200);
//
// Pure builders (no Playwright import), so unit tests can check the payload shapes against the handler's schemas.
import { randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";

const DAY = 86_400_000;

export type DodoEventType = "subscription.active" | "payment.succeeded" | "payment.failed" | "subscription.failed";

export type SubscriptionInput = {
  /** Clerk user id (`metadata.clerkUserId`: how the handler finds the member first). */
  clerkUserId: string;
  customerId: string;
  email: string;
  productId: string;
  subscriptionId?: string;
  interval?: "Month" | "Year";
  /** The instant the snapshot describes (default now). */
  at?: Date;
};

export type DodoSubscription = {
  subscription_id: string;
  product_id: string;
  status: string;
  next_billing_date: string;
  previous_billing_date: string;
  cancel_at_next_billing_date: boolean;
  created_at: string;
  payment_frequency_interval: "Month" | "Year";
  trial_period_days: number;
  recurring_pre_tax_amount: number;
  currency: "USD";
  customer: { customer_id: string; email: string };
  metadata: Record<string, string>;
};

function subscriptionOf(input: SubscriptionInput, trialDays: number, periodDays: number): DodoSubscription {
  const at = input.at ?? new Date();
  const interval = input.interval ?? "Month";
  return {
    subscription_id: input.subscriptionId ?? `sub_e2e_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    product_id: input.productId,
    status: "active",
    next_billing_date: new Date(at.getTime() + periodDays * DAY).toISOString(),
    previous_billing_date: at.toISOString(),
    cancel_at_next_billing_date: false,
    created_at: at.toISOString(),
    payment_frequency_interval: interval,
    trial_period_days: trialDays,
    recurring_pre_tax_amount: interval === "Year" ? 5000 : 499,
    currency: "USD",
    customer: { customer_id: input.customerId, email: input.email },
    metadata: { clerkUserId: input.clerkUserId },
  };
}

/** `subscription.active` at the start of the 7-day trial (no charge yet: the next billing date is the trial's end). */
export function trialSubscription(input: SubscriptionInput): DodoSubscription {
  return subscriptionOf(input, 7, 7);
}

/** `subscription.active` after the trial: the first charge went through, the period is the plan's. */
export function paidSubscription(input: SubscriptionInput): DodoSubscription {
  const days = (input.interval ?? "Month") === "Year" ? 365 : 30;
  return subscriptionOf(input, 7, days);
}

export type PaymentInput = {
  clerkUserId: string;
  customerId: string;
  email: string;
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
  /** Cents; a paid charge (> 0) may release the import backlog. */
  totalAmount?: number;
  /** `payment.failed` only: the processor's code (folded into `users.lastPaymentFailureReason`). */
  errorCode?: string;
};

/** `payment.succeeded` / `payment.failed` data (the fields the handler reads; plan 7.5.3). */
export function paymentData(input: PaymentInput): Record<string, unknown> {
  return {
    payment_id: `pay_e2e_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    customer: { customer_id: input.customerId, email: input.email },
    metadata: { clerkUserId: input.clerkUserId },
    subscription_id: input.subscriptionId ?? null,
    checkout_session_id: input.checkoutSessionId ?? null,
    total_amount: input.totalAmount ?? 499,
    currency: "USD",
    ...(input.errorCode ? { error_code: input.errorCode } : {}),
  };
}

export type SignedWebhook = { body: string; headers: Record<string, string> };

/** The signed request for one event (Standard Webhooks headers). Throws without a key: never send unsigned. */
export function signDodoWebhook(
  type: DodoEventType,
  data: unknown,
  opts: { key?: string; id?: string; at?: Date } = {},
): SignedWebhook {
  const key = opts.key ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  if (!key) throw new Error("DODO_PAYMENTS_WEBHOOK_KEY is not set: source apps/web/.env.test (the server's key)");
  const at = opts.at ?? new Date();
  const id = opts.id ?? `msg_e2e_${randomUUID()}`;
  const body = JSON.stringify({ business_id: "bus_e2e", type, timestamp: at.toISOString(), data });
  return {
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
      "webhook-signature": new Webhook(key).sign(id, at, body),
    },
  };
}

/** Anything with Playwright's `request.post` shape (an APIRequestContext), or a base URL for plain fetch. */
type Poster = { post(url: string, init: { data: string; headers: Record<string, string> }): Promise<{ status(): number; text(): Promise<string> }> };

/** Signs and POSTs one event to `/api/webhook/dodo-payments`; returns the status and body. */
export async function sendDodoWebhook(
  target: Poster | string,
  type: DodoEventType,
  data: unknown,
  opts: { key?: string; id?: string; at?: Date } = {},
): Promise<{ status: number; body: string }> {
  const signed = signDodoWebhook(type, data, opts);
  if (typeof target === "string") {
    const res = await fetch(`${target.replace(/\/$/, "")}/api/webhook/dodo-payments`, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, body: await res.text() };
  }
  const res = await target.post("/api/webhook/dodo-payments", { data: signed.body, headers: signed.headers });
  return { status: res.status(), body: await res.text() };
}
