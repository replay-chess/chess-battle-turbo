import { NextRequest } from "next/server";
import { webhookEndpoints } from "@repo/contracts/http/registry";
import { ApiError } from "@/lib/api/api-error";
import { route } from "@/lib/api/route";
import { NEW_USER_CLAIMS, syncClerkClaims } from "@/lib/auth/claims";
import { clerkEventTime, handleClerkEvent, type ClerkEvent, type ClerkOutcome } from "@/lib/webhooks/clerk-events";
import { processWebhook, safeLogError, WebhookHandlerError } from "@/lib/webhooks/record";

export const maxDuration = 15;

/** New users get the default claims directly (no read of Clerk first); a failure is only a warning. */
async function writeNewUserClaims(outcome: ClerkOutcome): Promise<void> {
  if (!outcome.clerkUserId) return;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    await (await clerkClient()).users.updateUserMetadata(outcome.clerkUserId, { publicMetadata: { ...NEW_USER_CLAIMS } });
  } catch (err) {
    const Sentry = await import("@sentry/nextjs");
    const status = err && typeof err === "object" && "status" in err ? String((err as { status: unknown }).status) : "none";
    Sentry.captureMessage("claims_sync_failed", { level: "warning", tags: { user: String(outcome.userId ?? ""), status } });
  }
}

/**
 * A7 · Clerk webhook (plan phase-01 §7.7): `user.created`, `user.updated`, `user.deleted`.
 *
 * Svix signature verified on the raw body with `verifyWebhook` (`CLERK_WEBHOOK_SIGNING_SECRET`); bad →
 * 401. `svix-id` is claimed in `webhook_events` with payload NULL (Clerk payloads hold PII and are
 * never stored); a duplicate → 200 `{ duplicate: true }`. Claims are written in after().
 */
export const POST = route({ ...webhookEndpoints.clerk, rawBody: true }, async ({ req, rawBody, after, now }) => {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    safeLogError("[Clerk] CLERK_WEBHOOK_SIGNING_SECRET is not set; refusing the webhook");
    throw new ApiError("not_configured");
  }

  const body = rawBody ?? "";
  let event: ClerkEvent;
  try {
    // Lazy: @clerk/nextjs is CommonJS, and the contract tests import every route module under plain Node ESM.
    const clerkWebhooks = await import("@clerk/nextjs/webhooks");
    const verifyWebhook =
      clerkWebhooks.verifyWebhook ?? (clerkWebhooks as unknown as { default: typeof clerkWebhooks }).default.verifyWebhook;
    // route() already read the body (bounded); verifyWebhook reads it from a fresh Request.
    event = await verifyWebhook(new NextRequest(req.url, { method: "POST", headers: req.headers, body }), { signingSecret });
  } catch {
    throw new ApiError("unauthorized", { message: "Invalid webhook signature." });
  }

  const eventId = req.headers.get("svix-id")!.trim();
  try {
    const { duplicate } = await processWebhook({
      provider: "clerk",
      eventId,
      type: event.type,
      eventTime: clerkEventTime(body, req.headers.get("svix-timestamp")),
      payload: null,
      receivedAt: now,
      handle: () => handleClerkEvent(event),
      after,
      userRefOf: (outcome) => outcome.userRef,
      onProcessed: (outcome) => {
        if (outcome.claims === "new") return writeNewUserClaims(outcome);
        if (outcome.claims === "sync" && outcome.userId) return syncClerkClaims(outcome.userId);
        return undefined;
      },
    });
    return { received: true as const, duplicate };
  } catch (err) {
    if (err instanceof WebhookHandlerError) {
      safeLogError("[Clerk] webhook handler failed", err.original, { type: event.type });
      throw new ApiError("internal");
    }
    throw err;
  }
});
