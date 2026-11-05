import { z } from "zod";

/** Every webhook answers this once the signature checks out; duplicates are 200 with duplicate: true. */
export const WebhookAckData = z.object({ received: z.literal(true), duplicate: z.boolean() });
export type WebhookAckData = z.infer<typeof WebhookAckData>;
