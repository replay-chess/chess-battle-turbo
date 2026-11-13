import { webhookEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { route } from "@/lib/api/route";
import { syncClerkClaims } from "@/lib/auth/claims";
import { eventTimeOf, handleDodoEvent, unwrapDodoEvent, type DodoEvent } from "@/lib/billing/dodo-events";
import { processWebhook, safeLogError, WebhookHandlerError } from "@/lib/webhooks/record";

export const maxDuration = 15;

/**
 * A8 · Dodo Payments webhook (plan phase-01 §7.7).
 *
 * 1. Verify the Standard Webhooks signature on the raw body (`dodo.webhooks.unwrap`); bad → 401.
 * 2. Claim `webhook-id` in `webhook_events` (first statement); a duplicate → 200 `{ duplicate: true }`.
 * 3. Apply with the compare-and-set (`lib/billing/dodo-events.ts`, §8.11); write the outcome. A write that landed queues
 *    the phase-4 entitlement fan-out in after() through the compare-and-set's post-apply hook (lib/billing/fanout.ts:
 *    `entitlement:changed`, waiting imports, trial ledger, backlog, membershipEndedAt); a stale or replayed snapshot
 *    writes nothing and fans out nothing. Phase 4 also records `payment.failed` / `subscription.failed` and runs the
 *    duplicate-trial guard there (phase-04 plan 7.5.3, 8.4.5).
 * 4. In after(): sync the Clerk claims when the row changed, the payment-failure emit and the paid-charge backlog
 *    release (phase 4), and the `webhook_processed` event.
 *
 * The key is read per request, never at module load: `next build` imports this module, and a build
 * without DODO_PAYMENTS_WEBHOOK_KEY must not fail. Without the key every delivery is refused (503).
 */
export const POST = route({ ...webhookEndpoints.dodo, rawBody: true }, async ({ req, rawBody, after, now }) => {
  const key = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
  if (!key) {
    safeLogError("[Dodo] DODO_PAYMENTS_WEBHOOK_KEY is not set; refusing the webhook");
    throw new ApiError("not_configured");
  }

  let event: DodoEvent;
  try {
    event = unwrapDodoEvent(rawBody ?? "", Object.fromEntries(req.headers), key);
  } catch {
    throw new ApiError("unauthorized", { message: "Invalid webhook signature." });
  }
  if (!event || typeof event.type !== "string") throw new ApiError("unauthorized", { message: "Invalid webhook payload." });

  const eventId = req.headers.get("webhook-id")!.trim();
  try {
    const { duplicate } = await processWebhook({
      provider: "dodo",
      eventId,
      type: event.type,
      eventTime: eventTimeOf(event),
      payload: event,
      receivedAt: now,
      handle: () => handleDodoEvent(event),
      after,
      userRefOf: (outcome) => outcome.userRef,
      onProcessed: async (outcome) => {
        if (outcome.userId && outcome.changed && event.type.startsWith("subscription.")) await syncClerkClaims(outcome.userId);
        if (outcome.userId && outcome.userRef && (outcome.paymentFailed || outcome.releaseBacklog)) {
          const { onPaymentEffects } = await import("@/lib/billing/fanout");
          await onPaymentEffects({
            userId: outcome.userId,
            userRef: outcome.userRef,
            paymentFailed: outcome.paymentFailed === true,
            releaseBacklog: outcome.releaseBacklog === true,
          });
        }
      },
    });
    return { received: true as const, duplicate };
  } catch (err) {
    if (err instanceof WebhookHandlerError) {
      safeLogError("[Dodo] webhook handler failed", err.original, { type: event.type });
      throw new ApiError("internal");
    }
    throw err;
  }
});
