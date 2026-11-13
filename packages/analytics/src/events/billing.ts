// Billing events of phase 4 (phase-04 plan 10.1, TST X6): the checkout start, the activation pages (`/checkout/activating`
// and the onboarding activating step share ActivationCard) and the server events of the checkout and the Dodo webhook
// fan-out. Closed property sets: no email, subscription id, reference or amount beyond the plan's interval; waited times
// are milliseconds capped at 30 minutes. P4 owns `checkout_start_failed`; P11 reuses it (consistency R-18).
import { z } from "zod";

/** Where a checkout started (CT/http/billing CHECKOUT_SOURCES), or `unknown` for a return without one (legacy URLs). */
export const CHECKOUT_EVENT_SOURCES = ["pricing", "onboarding", "paywall", "renew", "unknown"] as const;
/** Dodo's `status` return parameter, folded to a closed set (it is a hint only; the server never trusts it). */
export const CHECKOUT_STATUS_PARAMS = ["active", "succeeded", "failed", "cancelled", "pending", "none", "other"] as const;
/** How the activation page learned the membership was active. */
export const ACTIVATION_VIA = ["socket", "poll", "self_heal", "already"] as const;
export const ACTIVATION_FAIL_REASONS = ["declined", "cancelled", "url_status"] as const;
export const PLAN_KEYS = ["monthly", "yearly"] as const;
export const PLAN_INTERVALS = ["month", "year"] as const;

const source = z.enum(CHECKOUT_EVENT_SOURCES);
/** 0 .. 30 min. */
const waitedMs = z.number().int().min(0).max(1_800_000);
/** An `ErrorCode` of CT/http/codes (snake_case) or a client-only code (network, timeout, offline). */
const errorCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

/** The Dodo `status` parameter as a CHECKOUT_STATUS_PARAMS value. */
export function checkoutStatusParam(raw: string | null | undefined): (typeof CHECKOUT_STATUS_PARAMS)[number] {
  if (!raw) return "none";
  const v = raw.trim().toLowerCase();
  return (CHECKOUT_STATUS_PARAMS as readonly string[]).includes(v) ? (v as (typeof CHECKOUT_STATUS_PARAMS)[number]) : "other";
}

// ── Client events (`trackBilling()`, apps/web/lib/billing/telemetry.ts) ──────────────────────────────────────────
export const billingClientEvents = {
  checkout_started: z.object({ source, plan: z.enum(PLAN_KEYS), is_trial: z.boolean() }).strict(),
  checkout_start_failed: z.object({ code: errorCode }).strict(),
  /** Once per activating-page mount. */
  checkout_returned: z.object({ status_param: z.enum(CHECKOUT_STATUS_PARAMS), source }).strict(),
  checkout_activation_succeeded: z
    .object({ waited_ms: waitedMs, via: z.enum(ACTIVATION_VIA), is_trial: z.boolean(), source })
    .strict(),
  checkout_activation_stalled: z.object({ waited_ms: waitedMs, source }).strict(),
  checkout_activation_failed: z.object({ reason: z.enum(ACTIVATION_FAIL_REASONS), source }).strict(),
  checkout_check_again_clicked: z.object({ source }).strict(),
  checkout_support_clicked: z.object({ source }).strict(),
} as const;

// ── Server events (posthog-node in `after()`, distinct_id = User.referenceId) ────────────────────────────────────
export const billingServerEvents = {
  /** The webhook fan-out, on the first trialing snapshot (plan 8.5.4 step 3). */
  trial_started: z.object({ plan_interval: z.enum(PLAN_INTERVALS), source }).strict(),
  /** The fan-out, when the first paid period starts (trial → paid, or a paid first subscription). */
  subscription_activated: z.object({ plan_interval: z.enum(PLAN_INTERVALS), source }).strict(),
  /** The checkout refused a trial because the ledger knew the person (fraud signal, plan 8.4). */
  trial_ledger_hit: z.object({ kind: z.enum(["email", "handle"]) }).strict(),
} as const;

export const billingEvents = { ...billingClientEvents, ...billingServerEvents } as const;
