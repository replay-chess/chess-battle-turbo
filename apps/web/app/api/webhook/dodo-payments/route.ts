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
 * 3. Apply with the compare-and-set (`lib/billing/dodo-events.ts`, §8.11); write the outcome.
 * 4. In after(): sync the Clerk claims when the row changed, and the `webhook_processed` event.
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
      onProcessed: (outcome) =>
        outcome.userId && outcome.changed && event.type.startsWith("subscription.")
          ? syncClerkClaims(outcome.userId)
          : undefined,
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
