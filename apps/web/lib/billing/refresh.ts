// POST /api/billing/refresh (plan A19, CA AP-31): the one place a viewer-triggered request reads Dodo.
//
//   1. link the Dodo customer by the verified email when the row has none (the self-heal that used to run on every
//      GET /api/subscription);
//   2. list the customer's subscriptions, pick the primary one (pickPrimarySubscription);
//   3. apply it with the compare-and-set (applySubscriptionSnapshot, plan §8.11, 1B·F4b);
//   4. return the resulting summary. Dodo unreachable or a lost compare-and-set → the stored summary,
//      `refreshed: false`.
//
// Statements: the link (rare) + the apply's read + its compare-and-set ≤ 3, plus route()'s viewer read ≤ 4.
// The provider and the apply are injected so the logic is unit-tested without Dodo or Postgres (refresh.test.ts);
// entitlement.ts (server-only) and the Dodo SDK load lazily so route modules stay importable by the contract tests.
import type { EntitlementSummary, SubscriptionSnapshot } from "./entitlement-rules";
import { pickPrimarySubscription } from "./entitlement-rules";
import type { ApplyOptions, ApplyOutcome } from "./entitlement";

type Env = Readonly<Record<string, string | undefined>>;

/** What a refresh needs from Dodo. */
export interface BillingProvider {
  /** The customer id for this email, or null when Dodo has none. */
  findCustomerIdByEmail(email: string): Promise<string | null>;
  /** The customer's subscriptions (bounded). */
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
}

/** Per-call Dodo limits: the activation poll calls this every 2 s, so never wait on the SDK's 60 s default. */
export const DODO_TIMEOUT_MS = 5_000;
export const DODO_MAX_RETRIES = 1;
/** A customer with more subscriptions than this is not a real member; the primary is among the newest anyway. */
export const MAX_SUBSCRIPTIONS = 50;

let providerOverride: BillingProvider | null | undefined;

/** Test seam (contract and unit tests): replaces the provider; returns a restore function. */
export function setBillingProvider(provider: BillingProvider | null): () => void {
  const previous = providerOverride;
  providerOverride = provider;
  return () => {
    providerOverride = previous;
  };
}

/** The Dodo provider, or null when DODO_PAYMENTS_API_KEY is not set (the route answers 503 not_configured). */
export async function getBillingProvider(env: Env = process.env): Promise<BillingProvider | null> {
  if (providerOverride !== undefined) return providerOverride;
  if (!env.DODO_PAYMENTS_API_KEY) return null;
  const { dodo } = await import("@/lib/dodo");
  const options = { timeout: DODO_TIMEOUT_MS, maxRetries: DODO_MAX_RETRIES };
  return {
    async findCustomerIdByEmail(email) {
      for await (const customer of dodo.customers.list({ email }, options)) {
        return customer.customer_id;
      }
      return null;
    },
    async listSubscriptions(customerId) {
      const out: SubscriptionSnapshot[] = [];
      for await (const subscription of dodo.subscriptions.list({ customer_id: customerId }, options)) {
        out.push(subscription);
        if (out.length >= MAX_SUBSCRIPTIONS) break;
      }
      return out;
    },
  };
}

export type RefreshInput = {
  userId: bigint;
  email: string;
  dodoCustomerId: string | null;
  subscriptionProductId: string | null;
  /** The stored state (the viewer's summary), returned whenever Dodo can't be read. */
  stored: EntitlementSummary;
};

export type RefreshDeps = {
  provider: BillingProvider;
  /** Sets users.dodoCustomerId when still NULL; false when another row already holds the id. */
  linkCustomer(userId: bigint, customerId: string): Promise<boolean>;
  apply(snapshot: SubscriptionSnapshot, options: ApplyOptions): Promise<ApplyOutcome>;
  warn(message: string, context: Record<string, string>): void;
  now: Date;
};

export type RefreshResult = {
  summary: EntitlementSummary;
  /** The customer id after the refresh (linked now, or already stored). */
  customerId: string | null;
  /** The product of the subscription the summary describes (for the legacy body). */
  productId: string | null;
  /** False when Dodo was unreachable or the compare-and-set gave up: `summary` is the stored state. */
  refreshed: boolean;
  /** True when the users row was written (the caller syncs the Clerk claims). */
  changed: boolean;
  /**
   * The primary subscription's scheduled plan change from this Dodo read (null: none). Undefined when Dodo was not
   * read, so the caller can tell "none" from "unknown".
   */
  scheduledChange?: { productId: string; effectiveAt: string } | null;
};

function scheduledChangeOf(primary: SubscriptionSnapshot | null): RefreshResult["scheduledChange"] {
  const change = primary?.scheduled_change;
  if (!change) return null;
  const at = change.effective_at instanceof Date ? change.effective_at.toISOString() : String(change.effective_at);
  return { productId: change.product_id, effectiveAt: at };
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export async function refreshMembership(input: RefreshInput, deps: RefreshDeps): Promise<RefreshResult> {
  const stored: RefreshResult = {
    summary: input.stored,
    customerId: input.dodoCustomerId,
    productId: input.subscriptionProductId,
    refreshed: false,
    changed: false,
  };

  let customerId = input.dodoCustomerId;
  let changed = false;
  try {
    if (!customerId && input.email) {
      const found = await deps.provider.findCustomerIdByEmail(input.email);
      if (found) {
        if (await deps.linkCustomer(input.userId, found)) {
          customerId = found;
          changed = true;
        } else {
          deps.warn("[billing] refresh: customer id already linked to another user", { user: String(input.userId) });
        }
      }
    }
    if (!customerId) return { ...stored, refreshed: true, changed };

    const primary = pickPrimarySubscription(await deps.provider.listSubscriptions(customerId), deps.now);
    if (!primary) return { ...stored, customerId, refreshed: true, changed, scheduledChange: null };

    const outcome = await deps.apply(primary, { source: "api", userId: input.userId, now: deps.now });
    if (outcome.status === "applied" || outcome.status === "stale") {
      return {
        summary: outcome.entitlement,
        customerId,
        // A stale snapshot lost to a newer webhook: the stored row (and its product) is the truth.
        productId: outcome.status === "applied" ? primary.product_id : input.subscriptionProductId,
        refreshed: true,
        changed: changed || outcome.changed,
        scheduledChange: scheduledChangeOf(primary),
      };
    }
    deps.warn("[billing] refresh: snapshot not applied", { user: String(input.userId), status: outcome.status });
    return { ...stored, customerId, changed };
  } catch (err) {
    deps.warn("[billing] refresh: Dodo unreachable, using the stored entitlement", {
      user: String(input.userId),
      error: errorName(err),
    });
    return { ...stored, customerId, changed };
  }
}

/** Production dependencies (Prisma link, the compare-and-set, logger). */
export async function defaultRefreshDeps(provider: BillingProvider, now: Date): Promise<RefreshDeps> {
  const [{ prisma }, { logger }] = await Promise.all([import("@/lib/prisma"), import("@/lib/logger")]);
  return {
    provider,
    now,
    async linkCustomer(userId, customerId) {
      try {
        const res = await prisma.user.updateMany({ where: { id: userId, dodoCustomerId: null }, data: { dodoCustomerId: customerId } });
        return res.count === 1;
      } catch (err) {
        if ((err as { code?: unknown })?.code === "P2002") return false;
        throw err;
      }
    },
    // entitlement.ts is server-only: loaded only when there is a snapshot to apply.
    apply: async (snapshot, options) => (await import("./entitlement")).applySubscriptionSnapshot(snapshot, options),
    warn(message, context) {
      try {
        logger.warn(message, context);
      } catch {
        // Logging never fails a refresh.
      }
    },
  };
}
