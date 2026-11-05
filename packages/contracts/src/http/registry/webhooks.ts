import { defineEndpoint } from "../endpoint";
import { WebhookAckData } from "../webhooks";

export const webhookEndpoints = {
  /** A8. Standard Webhooks signature; deduped on webhook-id; compare-and-set apply. */
  dodo: defineEndpoint({
    id: "webhook.dodo",
    method: "POST",
    path: "/api/webhook/dodo-payments",
    auth: "webhook",
    class: "WH",
    cache: "no-store",
    maxBodyBytes: 262_144,
    response: WebhookAckData,
    summary: "Dodo Payments subscription and payment events",
  }),
  /** A7. Svix signature; user.created, user.updated, user.deleted. */
  clerk: defineEndpoint({
    id: "webhook.clerk",
    method: "POST",
    path: "/api/webhook/clerk",
    auth: "webhook",
    class: "WH",
    cache: "no-store",
    maxBodyBytes: 262_144,
    response: WebhookAckData,
    summary: "Clerk user lifecycle events",
  }),
} as const;
