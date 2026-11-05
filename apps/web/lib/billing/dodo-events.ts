import DodoPayments from "dodopayments";
import { z } from "zod";
import { logger } from "@/lib/logger";
import type { WebhookOutcome } from "@/lib/webhooks/record";
import type { ApplyOutcome } from "./entitlement";
import type { SubscriptionSnapshot } from "./entitlement-rules";

/**
 * Dodo Payments webhook events (plan phase-01 §7.7). The route verifies the signature and claims the
 * event in `webhook_events`; this module turns one verified event into a user-row change and an
 * outcome. Server code: `entitlement.ts` (server-only) is loaded on first use, so the route module
 * stays importable by the contract tests under plain Node. Every subscription write goes through the compare-and-set of `applySubscriptionSnapshot`
 * with the webhook timestamp as the provider time (§8.11).
 */

/** The subset of a subscription event we persist; anything extra is ignored. */
export const subscriptionSnapshotSchema = z.object({
  subscription_id: z.string().min(1),
  product_id: z.string().min(1),
  status: z.string().min(1),
  next_billing_date: z.union([z.string(), z.date()]),
  cancel_at_next_billing_date: z.boolean().default(false),
  created_at: z.union([z.string(), z.date()]).optional(),
  payment_frequency_interval: z.string().optional(),
  trial_period_days: z.number().int().nullable().optional(),
  customer: z.object({
    customer_id: z.string().min(1),
    email: z.string(),
    name: z.string().optional(),
  }),
});

const paymentCustomerSchema = z.object({
  customer: z.object({ customer_id: z.string().min(1), email: z.string().optional() }).optional(),
});

/** A verified Dodo event as the handler needs it. */
export interface DodoEvent {
  type: string;
  timestamp?: string | Date | null;
  data?: unknown;
}

function safeWarn(message: string, context: Record<string, string>): void {
  try {
    logger.warn(message, context);
  } catch {
    // Logging must never fail a webhook.
  }
}

/** The outcome stored on `webhook_events`, plus what the route needs for after(). */
export type DodoOutcome = WebhookOutcome & { userRef?: string | null };

// Lazy: `next build` imports the route to collect page data, and the client constructor throws without
// DODO_PAYMENTS_API_KEY. Unwrapping needs only the webhook key, which the route passes explicitly.
let client: DodoPayments | undefined;
function webhookClient(): DodoPayments {
  client ??= new DodoPayments({ bearerToken: process.env.DODO_PAYMENTS_API_KEY || "webhook-verify-only" });
  return client;
}

/**
 * Verifies the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`,
 * 5-minute tolerance) on the raw body and parses it: `dodo.webhooks.unwrap`. Throws on a bad signature.
 */
export function unwrapDodoEvent(rawBody: string, headers: Record<string, string>, key: string): DodoEvent {
  return webhookClient().webhooks.unwrap(rawBody, { headers, key }) as DodoEvent;
}

/** The event's provider time, or null when missing or unparseable. */
export function eventTimeOf(event: DodoEvent): Date | null {
  const raw = event.timestamp;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The `webhook_events` status for an apply outcome. */
export function outcomeFromApply(result: ApplyOutcome): DodoOutcome {
  switch (result.status) {
    case "applied":
      return { status: "applied", changed: result.changed, userId: result.userId, userRef: result.userRef };
    case "stale":
      return { status: "stale", changed: false, userId: result.userId, userRef: result.userRef };
    case "unmatched":
      return { status: "unmatched", changed: false };
    case "error":
      return { status: "error", changed: false, userId: result.userId, userRef: result.userRef, error: result.error };
  }
}

export interface PaymentLinkStore {
  /** The user with this email, if any. */
  findByEmail(email: string): Promise<{ id: bigint; referenceId: string; dodoCustomerId: string | null } | null>;
  /** Sets dodoCustomerId only while it is still NULL; returns rows written. */
  linkCustomer(id: bigint, customerId: string): Promise<number>;
}

export interface DodoEventDeps {
  apply: (snapshot: SubscriptionSnapshot, options: { source: "webhook"; eventTime: Date | null }) => Promise<ApplyOutcome>;
  payments: PaymentLinkStore;
  warn: (message: string, context: Record<string, string>) => void;
}

async function defaultPaymentStore(): Promise<PaymentLinkStore> {
  const { prisma } = await import("@/lib/prisma");
  return {
    findByEmail: (email) =>
      prisma.user.findUnique({ where: { email }, select: { id: true, referenceId: true, dodoCustomerId: true } }),
    linkCustomer: async (id, customerId) =>
      (await prisma.user.updateMany({ where: { id, dodoCustomerId: null }, data: { dodoCustomerId: customerId } })).count,
  };
}

/**
 * Applies one verified event. Rules kept from Phase 0: every `subscription.*` event carries the full
 * subscription and is applied as a snapshot; `payment.succeeded` links the Dodo customer to the user
 * with the same email so the subscription event that follows finds them by customer id. Anything
 * else is `ignored`. Database errors propagate (the route marks the event `error` and answers 500).
 */
export async function handleDodoEvent(event: DodoEvent, deps?: Partial<DodoEventDeps>): Promise<DodoOutcome> {
  const apply: DodoEventDeps["apply"] =
    deps?.apply ??
    (async (snapshot, options) => (await import("./entitlement")).applySubscriptionSnapshot(snapshot, options));

  if (event.type.startsWith("subscription.")) {
    const parsed = subscriptionSnapshotSchema.safeParse(event.data);
    if (!parsed.success) {
      (deps?.warn ?? safeWarn)("[Dodo] subscription event without the subscription fields", { type: event.type });
      return { status: "ignored", changed: false, error: "payload_missing_fields" };
    }
    const result = await apply(parsed.data as SubscriptionSnapshot, { source: "webhook", eventTime: eventTimeOf(event) });
    return outcomeFromApply(result);
  }

  if (event.type === "payment.succeeded") {
    const parsed = paymentCustomerSchema.safeParse(event.data);
    const customer = parsed.success ? parsed.data.customer : undefined;
    if (!customer?.email) return { status: "ignored", changed: false };
    const payments = deps?.payments ?? (await defaultPaymentStore());
    const user = await payments.findByEmail(customer.email);
    if (!user) return { status: "unmatched", changed: false };
    if (user.dodoCustomerId) return { status: "applied", changed: false, userId: user.id, userRef: user.referenceId };
    const written = await payments.linkCustomer(user.id, customer.customer_id);
    return { status: "applied", changed: written === 1, userId: user.id, userRef: user.referenceId };
  }

  return { status: "ignored", changed: false };
}
