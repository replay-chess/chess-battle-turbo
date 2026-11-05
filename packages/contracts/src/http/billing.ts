import { z } from "zod";
import { Entitlement } from "./me";

/** POST /api/billing/refresh */
export const BillingRefreshData = z.object({
  entitlement: Entitlement,
  /** false when Dodo was unreachable and the stored state was returned. */
  refreshed: z.boolean(),
  /** The old SubscriptionResponse shape, for useUserStore until P10 (one release). */
  legacy: z.unknown(),
});
export type BillingRefreshData = z.infer<typeof BillingRefreshData>;

/** GET /api/subscription: the legacy SubscriptionResponse body, unchanged and not enveloped (described loosely). */
export const LegacySubscriptionResponse = z.unknown();
