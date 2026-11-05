import { z } from "zod";
import { Entitlement } from "./me";

/** A plan change waiting for the renewal date (a yearly → monthly downgrade). */
export const ScheduledPlanChange = z.object({
  productId: z.string(),
  /** "monthly" | "yearly" | "legacy", or null for a product outside the catalog. */
  planKey: z.string().nullable(),
  effectiveAt: z.string(),
});
export type ScheduledPlanChange = z.infer<typeof ScheduledPlanChange>;

/** POST /api/billing/refresh */
export const BillingRefreshData = z.object({
  entitlement: Entitlement,
  /** false when Dodo was unreachable and the stored state was returned. */
  refreshed: z.boolean(),
  /**
   * The primary subscription's scheduled plan change, from the same Dodo read (null: none). Absent when the
   * provider was not read (unreachable, no customer, or a lost compare-and-set), so the caller keeps what it had.
   * Replaces the Phase 0 `GET /api/subscription/change-plan`, which read Dodo on every profile view (P1-18).
   */
  scheduledChange: ScheduledPlanChange.nullable().optional(),
  /** The old SubscriptionResponse shape, for useUserStore until P10 (one release). */
  legacy: z.unknown(),
});
export type BillingRefreshData = z.infer<typeof BillingRefreshData>;

/** GET /api/subscription: the legacy SubscriptionResponse body, unchanged and not enveloped (described loosely). */
export const LegacySubscriptionResponse = z.unknown();
