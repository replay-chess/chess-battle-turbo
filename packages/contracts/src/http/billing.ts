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

// ── P4 (phase-04 plan §7.1, §7.5, §8.5): checkout rework and the activation read ───────────────────────────────────
/** Where a checkout starts; picks the return URL (`buildActivationReturnUrl`) and whether onboarding advances. */
export const CHECKOUT_SOURCES = ["pricing", "onboarding", "paywall", "renew"] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];

export const CheckoutPlan = z.enum(["monthly", "yearly"]);
export type CheckoutPlan = z.infer<typeof CheckoutPlan>;

/** BIL-1 `POST /api/checkout` (Idempotency-Key required; a replay returns the same checkoutUrl). */
export const CheckoutBody = z.strictObject({
  plan: CheckoutPlan,
  source: z.enum(CHECKOUT_SOURCES),
  /** Same-origin path the activating page continues to (allow-listed server-side). */
  returnPath: z.string().max(512).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
});
export type CheckoutBody = z.infer<typeof CheckoutBody>;

export const CheckoutData = z.object({
  checkoutUrl: z.url(),
  sessionId: z.string().max(80),
  trial: z.boolean(),
  /** now + 7 days with a trial, else null (the card is charged today). */
  chargeDate: z.iso.datetime().nullable(),
  priceCents: z.int().min(0),
  currency: z.literal("USD"),
  interval: z.enum(["month", "year"]),
});
export type CheckoutData = z.infer<typeof CheckoutData>;

/** BIL-2 query. `status` is Dodo's hint for the client only; the server never treats it as proof of payment. */
export const ActivationQuery = z.object({
  session_id: z.string().max(80).optional(),
  subscription_id: z.string().max(80).optional(),
  status: z.string().max(32).optional(),
  force: z.literal("1").optional(),
});
export type ActivationQuery = z.infer<typeof ActivationQuery>;

export const ActivationState = z.enum(["pending", "active", "failed"]);
export type ActivationState = z.infer<typeof ActivationState>;

/** BIL-2 `GET /api/billing/activation` (polled; the route sets `rc_act` on the first `active`). */
export const ActivationData = z.object({
  state: ActivationState,
  reason: z.enum(["declined", "cancelled"]).nullable(),
  entitlement: Entitlement,
  trial: z.object({ active: z.boolean(), endsAt: z.iso.datetime().nullable(), chargeDate: z.iso.datetime().nullable() }),
  plan: z.object({ interval: z.enum(["month", "year"]), priceCents: z.int().min(0), legacy: z.boolean() }).nullable(),
  /** "k•••@gmail.com" */
  emailMasked: z.string().max(120).nullable(),
  /** "sub_8F2K…Q1" */
  reference: z.string().max(16).nullable(),
  /** now − pendingCheckoutAt (0 without a pending checkout). */
  waitedMs: z.int().min(0),
});
export type ActivationData = z.infer<typeof ActivationData>;

/** BIL-1. */
export const CHECKOUT_LIMIT = { bucket: "checkout", limit: 6, windowSec: 60, by: "user" } as const;
/** BIL-2 (the plan's `billing-refresh 40/60`: its own bucket name, because `billing-refresh` is 10/60 on A19). */
export const ACTIVATION_LIMIT = { bucket: "billing-activation", limit: 40, windowSec: 60, by: "user" } as const;
/** BIL-2's Dodo lookups, applied by the handler only when it would call Dodo (§8.5.1 step 4). */
export const DODO_ACTIVATION_LIMIT = { bucket: "dodo-activation", limit: 1, windowSec: 5, by: "user" } as const;
/** A pending checkout older than this is abandoned (the resolver sends the user back to plan). Zod-free source. */
export { PENDING_CHECKOUT_TTL_MS } from "./p04-plain";
/** BIL-2 asks Dodo only after the return has waited this long (the webhook usually wins). */
export const ACTIVATION_DODO_AFTER_MS = 6_000;
