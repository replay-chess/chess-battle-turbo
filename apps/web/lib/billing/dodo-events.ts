import DodoPayments from "dodopayments";
import { z } from "zod";
import { logger } from "@/lib/logger";
import type { WebhookOutcome } from "@/lib/webhooks/record";
import type { ApplyOutcome } from "./entitlement";
import { fieldsFromSnapshot, isEntitled, type EntitlementCore, type SubscriptionSnapshot } from "./entitlement-rules";

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
  /** Phase 4: a paid charge (> 0) may release the import backlog (plan 7.5.3). */
  total_amount: z.number().optional(),
});

/** `payment.failed` (phase-04 plan 7.5.3): who it belongs to and why. Anything extra is ignored. */
const paymentFailedSchema = z.object({
  customer: z.object({ customer_id: z.string().min(1).optional(), email: z.string().optional() }).partial().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  subscription_id: z.string().nullable().optional(),
  checkout_session_id: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
});

/** `subscription.failed` carries the subscription (+ its checkout metadata). */
const subscriptionMetaSchema = z.object({ metadata: z.record(z.string(), z.unknown()).nullable().optional() });

/** `users.lastPaymentFailureReason` is VARCHAR(120): a provider error code, folded to a safe token. */
export function failureReasonOf(raw: string | null | undefined, fallback: string): string {
  const token = (raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return (token || fallback).slice(0, 120);
}

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
export type DodoOutcome = WebhookOutcome & {
  userRef?: string | null;
  /** Phase 4: a payment failure was recorded for this user → after(): `entitlement:changed {paymentFailed: true}`. */
  paymentFailed?: boolean;
  /** Phase 4: a paid charge for a user with an initial import → after(): release the analysis backlog (idempotent). */
  releaseBacklog?: boolean;
};

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
    case "duplicate":
      return { status: "ignored", changed: false, userId: result.userId, userRef: result.userRef, error: "duplicate_subscription" };
  }
}

export interface PaymentLinkStore {
  /** The user with this email, if any. */
  findByEmail(email: string): Promise<{ id: bigint; referenceId: string; dodoCustomerId: string | null } | null>;
  /** Sets dodoCustomerId only while it is still NULL; returns rows written. */
  linkCustomer(id: bigint, customerId: string): Promise<number>;
}

/** Who a payment failure belongs to, and its write (phase-04 plan 7.5.3). */
export interface PaymentFailureStore {
  /** metadata.clerkUserId, then the Dodo customer, then the subscription, then the (case-insensitive) email. */
  resolveUser(keys: { clerkUserId?: string; customerId?: string; subscriptionId?: string; email?: string }): Promise<{ id: bigint; referenceId: string } | null>;
  /** Only moves forward: returns 0 when a newer failure is already stored. */
  record(userId: bigint, at: Date, reason: string): Promise<number>;
}

/** Which duplicate the guard stopped: a second trial (plan 8.4.5) or a second paid subscription (FIX-1). */
export type DuplicateKind = "trial" | "paid";

/** The webhook's duplicate-trial guard (plan 8.4.5), also used for a duplicate paid subscription (FIX-1). */
export interface DuplicateTrialGuard {
  /** The user this snapshot belongs to, with the subscription their row holds now. */
  findHolder(keys: { clerkUserId?: string; customerId?: string; email?: string }): Promise<HolderRow | null>;
  /** Dodo `subscriptions.update(id, {cancel_at_next_billing_date: true})`: the duplicate ends at its trial end. */
  cancelAtNextBillingDate(subscriptionId: string): Promise<void>;
  /**
   * `audit_logs billing.duplicate_trial_cancelled` (a second trial) or `billing.duplicate_subscription_cancelled` (a
   * second PAID subscription: its first charge is listed for a refund) + a Sentry warning.
   */
  report(holder: HolderRow, duplicateId: string, kind?: DuplicateKind): Promise<void>;
}

export type HolderRow = EntitlementCore & {
  id: bigint;
  referenceId: string;
  subscriptionId: string | null;
};

/** A paid charge: does this user have an initial import whose backlog was never released? */
export interface BacklogProbe {
  pending(userId: bigint): Promise<boolean>;
}

export interface DodoEventDeps {
  apply: (snapshot: SubscriptionSnapshot, options: { source: "webhook"; eventTime: Date | null }) => Promise<ApplyOutcome>;
  payments: PaymentLinkStore;
  failures: PaymentFailureStore;
  guard: DuplicateTrialGuard;
  backlog: BacklogProbe;
  warn: (message: string, context: Record<string, string>) => void;
  /** The handler's clock when the event has no timestamp. */
  now: () => Date;
}

async function defaultPaymentStore(): Promise<PaymentLinkStore> {
  const { prisma } = await import("@/lib/prisma");
  return {
    // Phase 4 (plan 7.5.3): case-insensitive, fixing the exact-match lookup of Phase 0.
    findByEmail: async (email) =>
      (
        await prisma.$queryRawUnsafe<{ id: bigint; referenceId: string; dodoCustomerId: string | null }[]>(
          `SELECT id, "referenceId", "dodoCustomerId" FROM users WHERE lower(email) = lower($1) ORDER BY id LIMIT 1`,
          email,
        )
      )[0] ?? null,
    linkCustomer: async (id, customerId) =>
      (await prisma.user.updateMany({ where: { id, dodoCustomerId: null }, data: { dodoCustomerId: customerId } })).count,
  };
}

/** Resolution order of plan 7.5.3 in one statement (each key is optional; a NULL key matches nothing). */
export const RESOLVE_FAILURE_USER_SQL = `SELECT id, "referenceId" FROM users
WHERE "googleId" = $1 OR "dodoCustomerId" = $2 OR "subscriptionId" = $3 OR lower(email) = lower($4)
ORDER BY ("googleId" = $1) IS TRUE DESC, ("dodoCustomerId" = $2) IS TRUE DESC, ("subscriptionId" = $3) IS TRUE DESC, id
LIMIT 1`;

/** Plan 7.5.3: the failure time only moves forward (an out-of-order older failure writes nothing). */
export const RECORD_FAILURE_SQL = `UPDATE users SET "lastPaymentFailedAt" = $2::timestamp(3), "lastPaymentFailureReason" = $3
WHERE id = $1 AND ("lastPaymentFailedAt" IS NULL OR "lastPaymentFailedAt" < $2::timestamp(3))`;

/** Plan 7.5.3: an INITIAL import run exists and no backlog job was ever queued for the user. */
export const BACKLOG_PENDING_SQL = `SELECT EXISTS (SELECT 1 FROM import_runs r WHERE r."userId" = $1 AND r.trigger = 'INITIAL')
   AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j."userId" = $1 AND j.kind = 'ANALYZE_GAME' AND j.priority = $2) AS pending`;

async function defaultFailureStore(): Promise<PaymentFailureStore> {
  const { prisma } = await import("@/lib/prisma");
  return {
    async resolveUser(keys) {
      const rows = await prisma.$queryRawUnsafe<{ id: bigint; referenceId: string }[]>(
        RESOLVE_FAILURE_USER_SQL,
        keys.clerkUserId ?? null,
        keys.customerId ?? null,
        keys.subscriptionId ?? null,
        keys.email ?? null,
      );
      return rows[0] ?? null;
    },
    record: (userId, at, reason) => prisma.$executeRawUnsafe(RECORD_FAILURE_SQL, userId, at.toISOString(), reason),
  };
}

async function defaultGuard(): Promise<DuplicateTrialGuard> {
  const [{ prisma }, { getDodoApi }] = await Promise.all([import("@/lib/prisma"), import("./dodo-api")]);
  return {
    async findHolder(keys) {
      const rows = await prisma.$queryRawUnsafe<HolderRow[]>(
        `SELECT id, "referenceId", "subscriptionId", "subscriptionStatus", "cancelAtPeriodEnd", "currentPeriodEnd" FROM users
         WHERE "googleId" = $1 OR "dodoCustomerId" = $2 OR lower(email) = lower($3)
         ORDER BY ("googleId" = $1) IS TRUE DESC, ("dodoCustomerId" = $2) IS TRUE DESC, id LIMIT 1`,
        keys.clerkUserId ?? null,
        keys.customerId ?? null,
        keys.email ?? null,
      );
      return rows[0] ?? null;
    },
    async cancelAtNextBillingDate(subscriptionId) {
      const api = await getDodoApi();
      if (!api) throw new Error("dodo_not_configured");
      await api.cancelAtNextBillingDate(subscriptionId);
    },
    async report(holder, duplicateId, kind = "trial") {
      const [{ audit }, Sentry] = await Promise.all([import("@/lib/audit"), import("@sentry/nextjs")]);
      const action = kind === "paid" ? "billing.duplicate_subscription_cancelled" : "billing.duplicate_trial_cancelled";
      await audit(null, {
        category: "BILLING",
        action,
        actorKind: "WEBHOOK",
        actorUserId: holder.id,
        targetType: "subscription",
        targetId: duplicateId,
        meta: kind === "paid" ? { kept: holder.subscriptionId, refund: "first_charge" } : { kept: holder.subscriptionId },
      });
      try {
        // Node's ESM interop may put the SDK on `default` (scripts, tests); Next's bundle exposes it directly.
        type SentryLike = { captureMessage?: (message: string, context: { level: "warning"; tags: Record<string, string> }) => unknown };
        const mod = Sentry as unknown as SentryLike & { default?: SentryLike };
        const sdk = typeof mod.captureMessage === "function" ? mod : mod.default;
        sdk?.captureMessage?.(action, { level: "warning", tags: { area: "billing" } });
      } catch {
        // The audit row is the record; a Sentry hiccup never fails the webhook.
      }
    },
  };
}

async function defaultBacklogProbe(): Promise<BacklogProbe> {
  const [{ prisma }, { JOB_PRIORITY }] = await Promise.all([import("@/lib/prisma"), import("@repo/contracts/internal/jobs")]);
  return {
    async pending(userId) {
      const rows = await prisma.$queryRawUnsafe<{ pending: boolean }[]>(BACKLOG_PENDING_SQL, userId, JOB_PRIORITY.BACKLOG);
      return rows[0]?.pending === true;
    },
  };
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v ? v : undefined;
}

/**
 * Plan 8.4.5 duplicate-trial guard. A snapshot of a TRIAL subscription Y that would grant access, for a user whose row
 * already holds a different, still-entitled subscription X: Y is cancelled at its next billing date (its trial end, so
 * it is never charged), audited, and NOT applied (X stays the member's subscription). Replays and later Y events find
 * Y already flagged and are ignored without a second Dodo call. A Dodo failure throws (the webhook answers 500 and
 * Dodo retries, so the cancel is never silently lost).
 *
 * FIX-1: the same for a PAID duplicate. An entitled member cannot start a checkout (POST /api/checkout answers
 * already_subscribed), so a second entitled subscription next to X can only come from two checkouts opened at once
 * (two tabs or devices, a ledger hit or a returning lapsed buyer: no trial, so the duplicate-trial rule never saw it).
 * Y is cancelled at its next billing date (it never renews), not applied, and audited as
 * `billing.duplicate_subscription_cancelled` with `refund: first_charge`: its first charge is refunded by the owner
 * from that audit row (decisions.md FIX-1). The checkout also refuses a second session once the first one is paid
 * (lib/billing/checkout.ts), so this is the rare both-pages-paid case.
 */
async function duplicateSubscription(
  snapshot: SubscriptionSnapshot & { metadata?: Record<string, unknown> | null },
  guard: DuplicateTrialGuard,
  now: Date,
): Promise<DodoOutcome | null> {
  if (!isEntitled(fieldsFromSnapshot(snapshot, {}), now)) return null;
  const holder = await guard.findHolder({
    clerkUserId: metaString(snapshot.metadata, "clerkUserId"),
    customerId: snapshot.customer?.customer_id || undefined,
    email: snapshot.customer?.email || undefined,
  });
  if (!holder || !holder.subscriptionId || holder.subscriptionId === snapshot.subscription_id) return null;
  if (!isEntitled(holder, now)) return null;
  const kind: DuplicateKind = snapshot.trial_period_days && snapshot.trial_period_days > 0 ? "trial" : "paid";
  if (!snapshot.cancel_at_next_billing_date) {
    await guard.cancelAtNextBillingDate(snapshot.subscription_id);
    await guard.report(holder, snapshot.subscription_id, kind);
  }
  return {
    status: "ignored",
    changed: false,
    userId: holder.id,
    userRef: holder.referenceId,
    error: kind === "trial" ? "duplicate_trial" : "duplicate_subscription",
  };
}

async function recordFailure(
  failures: PaymentFailureStore,
  keys: { clerkUserId?: string; customerId?: string; subscriptionId?: string; email?: string },
  at: Date,
  reason: string,
): Promise<DodoOutcome> {
  const user = await failures.resolveUser(keys);
  if (!user) return { status: "unmatched", changed: false };
  const written = await failures.record(user.id, at, reason);
  return { status: "applied", changed: written === 1, userId: user.id, userRef: user.referenceId, paymentFailed: written === 1 };
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

  const now = deps?.now?.() ?? new Date();
  const eventTime = eventTimeOf(event);

  if (event.type.startsWith("subscription.")) {
    const parsed = subscriptionSnapshotSchema.safeParse(event.data);
    if (!parsed.success) {
      (deps?.warn ?? safeWarn)("[Dodo] subscription event without the subscription fields", { type: event.type });
      return { status: "ignored", changed: false, error: "payload_missing_fields" };
    }
    const snapshot = parsed.data as SubscriptionSnapshot;
    const meta = subscriptionMetaSchema.safeParse(event.data);
    const metadata = meta.success ? (meta.data.metadata ?? null) : null;
    // A second TRIAL is caught before the apply (plan 8.4.5, one holder lookup, trial snapshots only); a second PAID
    // subscription is caught by the apply itself from its own user read (status "duplicate", FIX-1: no extra statement
    // on the happy path, 1B·F4b's 4-statement budget).
    if (snapshot.trial_period_days && snapshot.trial_period_days > 0) {
      const duplicate = await duplicateSubscription({ ...snapshot, metadata }, deps?.guard ?? (await defaultGuard()), now);
      if (duplicate) return duplicate;
    }
    const applied = await apply(snapshot, { source: "webhook", eventTime });
    if (applied.status === "duplicate") {
      const guard = deps?.guard ?? (await defaultGuard());
      const kind: DuplicateKind = snapshot.trial_period_days && snapshot.trial_period_days > 0 ? "trial" : "paid";
      if (!snapshot.cancel_at_next_billing_date) {
        await guard.cancelAtNextBillingDate(snapshot.subscription_id);
        await guard.report({ id: applied.userId, referenceId: applied.userRef, subscriptionId: applied.kept } as HolderRow, snapshot.subscription_id, kind);
      }
      return {
        status: "ignored",
        changed: false,
        userId: applied.userId,
        userRef: applied.userRef,
        error: kind === "trial" ? "duplicate_trial" : "duplicate_subscription",
      };
    }
    const outcome = outcomeFromApply(applied);
    if (event.type === "subscription.failed") {
      // The first charge (or the trial's card check) failed: record it so an open activation page answers `failed`.
      const failed = await recordFailure(
        deps?.failures ?? (await defaultFailureStore()),
        {
          clerkUserId: metaString(metadata, "clerkUserId"),
          customerId: snapshot.customer.customer_id,
          subscriptionId: snapshot.subscription_id,
          email: snapshot.customer.email || undefined,
        },
        eventTime ?? now,
        "subscription_failed",
      );
      if (failed.paymentFailed) return { ...outcome, userId: outcome.userId ?? failed.userId, userRef: outcome.userRef ?? failed.userRef, paymentFailed: true };
    }
    return outcome;
  }

  if (event.type === "payment.failed") {
    const parsed = paymentFailedSchema.safeParse(event.data);
    if (!parsed.success) return { status: "ignored", changed: false, error: "payload_missing_fields" };
    const p = parsed.data;
    return recordFailure(
      deps?.failures ?? (await defaultFailureStore()),
      {
        clerkUserId: metaString(p.metadata ?? null, "clerkUserId"),
        customerId: p.customer?.customer_id,
        subscriptionId: p.subscription_id ?? undefined,
        email: p.customer?.email || undefined,
      },
      eventTime ?? now,
      failureReasonOf(p.error_code, "payment_failed"),
    );
  }

  if (event.type === "payment.succeeded") {
    const parsed = paymentCustomerSchema.safeParse(event.data);
    const customer = parsed.success ? parsed.data.customer : undefined;
    if (!customer?.email) return { status: "ignored", changed: false };
    const payments = deps?.payments ?? (await defaultPaymentStore());
    const user = await payments.findByEmail(customer.email);
    if (!user) return { status: "unmatched", changed: false };
    const paid = parsed.success && (parsed.data.total_amount ?? 0) > 0;
    const releaseBacklog = paid && (await (deps?.backlog ?? (await defaultBacklogProbe())).pending(user.id));
    const extra = releaseBacklog ? { releaseBacklog: true } : {};
    if (user.dodoCustomerId) return { status: "applied", changed: false, userId: user.id, userRef: user.referenceId, ...extra };
    const written = await payments.linkCustomer(user.id, customer.customer_id);
    return { status: "applied", changed: written === 1, userId: user.id, userRef: user.referenceId, ...extra };
  }

  return { status: "ignored", changed: false };
}
