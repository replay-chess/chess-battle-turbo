// The activation read (phase-04 plan 8.5.1; BIL-2; D4-29, AP-06, AP-31). One DAL function backs both the RSC first
// paint of the activating pages (`{dodo: false}`: the database only) and `GET /api/billing/activation` (`{dodo: true}`),
// so the dehydrated query and the API body are the same shape (client-data-layer 2.3). The DAL never sets cookies; the
// route sets `rc_act` on `active`.
//
//   1. entitled (the request's viewer) → active (no statement);
//   2. read the billing columns (one statement);
//   3. a payment failure recorded after the pending checkout started → failed {declined};
//   4. Dodo is asked only from the API (`dodo: true`), only once the return has waited > 6 s, and only on `force=1`
//      or when the per-user `dodo-activation` bucket allows one check per 5 s:
//        - `subscription_id` → subscriptions.retrieve; it must be the viewer's (metadata.clerkUserId, the customer id or
//          the email) → applySubscriptionSnapshot (P1's compare-and-set, event time = the subscription's own
//          updated_at ?? created_at, never now()) → entitled → active (self-heal; the CAS's post-apply hook runs the
//          same fan-out as the webhook);
//        - else the pending checkout session → payment_status failed / cancelled → failed; succeeded → the P1 refresh
//          (refreshMembership: customer by email, primary subscription, the same CAS) → active when entitled;
//      a Dodo failure is `502 upstream_unavailable {provider: "dodo"}` on `force=1` (Check Again), silent otherwise;
//   5. otherwise pending.
// The URL's `status=` is a hint for the client only: the server never treats it as proof of payment.
import type { ActivationData, ActivationQuery } from "@repo/contracts/http/billing";
import { ACTIVATION_DODO_AFTER_MS, DODO_ACTIVATION_LIMIT } from "@repo/contracts/http/billing";
import type { Entitlement } from "@repo/contracts/http/me";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import type { ApplyOptions, ApplyOutcome } from "@/lib/billing/entitlement";
import type { EntitlementSummary } from "@/lib/billing/entitlement-rules";
import { dodoErrorKind, type DodoApi, type DodoSubscription } from "@/lib/billing/dodo-api";
import { BILLING_PLANS, isPlanKey } from "@/lib/billing/plans";
import { TRIAL_DAYS } from "@/lib/billing/trial-rules";

const DAY_MS = 86_400_000;

/** The users columns the activation read needs (one statement, by primary key). */
export type ActivationRow = {
  email: string;
  dodoCustomerId: string | null;
  subscriptionProductId: string | null;
  pendingCheckoutSessionId: string | null;
  pendingCheckoutPlan: string | null;
  pendingCheckoutAt: Date | null;
  trialOfferedAt: Date | null;
  lastPaymentFailedAt: Date | null;
};

export const ACTIVATION_ROW_SQL = `SELECT email, "dodoCustomerId", "subscriptionProductId", "pendingCheckoutSessionId", "pendingCheckoutPlan",
       "pendingCheckoutAt", "trialOfferedAt", "lastPaymentFailedAt"
FROM users WHERE id = $1`;

export type ActivationVia = "db" | "self_heal" | null;

export type ActivationResult = {
  data: ActivationData;
  /** How `active` was reached (null unless active): the row already said so, or this request's Dodo check. */
  via: ActivationVia;
  /** True when this request called Dodo (span tag `dodo: yes|no`, plan 9.1). */
  dodoCalled: boolean;
};

export interface ActivationDeps {
  readRow(userId: bigint): Promise<ActivationRow | null>;
  /** null without DODO_PAYMENTS_API_KEY. */
  dodo(): Promise<DodoApi | null>;
  /** DODO_ACTIVATION_LIMIT (1 / 5 s per user): true when this request may ask Dodo. */
  allowDodoCheck(clerkUserId: string): Promise<boolean>;
  apply(snapshot: DodoSubscription, options: ApplyOptions): Promise<ApplyOutcome>;
  /** P1's refresh (customer by email, primary subscription, the CAS); null when Dodo could not be read. */
  refresh(viewer: Viewer, now: Date): Promise<EntitlementSummary | null>;
  /** membership.ts entitlementOf for this viewer. */
  toWire(summary: EntitlementSummary, viewer: Viewer, now: Date): Entitlement;
  warn(message: string, context: Record<string, string>): void;
}

/** "k•••@gmail.com": the first character of the local part, then the domain. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const masked = `${email[0]}•••@${email.slice(at + 1)}`;
  return masked.length <= 120 ? masked : null;
}

/** "sub_8F2K…Q1": the first 8 and the last 2 characters of a Dodo id (≤ 16 characters, the contract's cap). */
export function shortReference(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length <= 11 ? id : `${id.slice(0, 8)}…${id.slice(-2)}`;
}

function ownsSubscription(sub: DodoSubscription, viewer: Viewer, row: ActivationRow): boolean {
  const meta = sub.metadata && typeof sub.metadata === "object" ? sub.metadata.clerkUserId : undefined;
  if (typeof meta === "string" && meta) return meta === viewer.clerkUserId;
  if (row.dodoCustomerId && sub.customer?.customer_id === row.dodoCustomerId) return true;
  const email = sub.customer?.email?.trim().toLowerCase();
  return !!email && email === row.email.trim().toLowerCase();
}

function providerTimeOf(sub: DodoSubscription): Date | null {
  const raw = sub.updated_at ?? sub.created_at ?? null;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function planOf(entitlement: Entitlement, row: ActivationRow | null): ActivationData["plan"] {
  if (entitlement.entitled && entitlement.interval && entitlement.priceCents !== null) {
    return { interval: entitlement.interval, priceCents: entitlement.priceCents, legacy: entitlement.planKey === "legacy" };
  }
  const key = row?.pendingCheckoutPlan;
  if (isPlanKey(key)) return { interval: BILLING_PLANS[key].interval, priceCents: BILLING_PLANS[key].priceCents, legacy: false };
  return null;
}

/** The answer for a state (pure; the route and the RSC page render the same object). */
export function activationData(
  state: ActivationData["state"],
  reason: ActivationData["reason"],
  entitlement: Entitlement,
  viewer: Viewer,
  row: ActivationRow | null,
  params: ActivationQuery,
  now: Date,
): ActivationData {
  const pendingAt = row?.pendingCheckoutAt ?? null;
  const trialOffered = !!(row?.trialOfferedAt && pendingAt && row.trialOfferedAt.getTime() >= pendingAt.getTime() - 1_000);
  const chargeDate = entitlement.trial.active
    ? entitlement.trial.endsAt
    : !entitlement.entitled && trialOffered && pendingAt
      ? new Date(pendingAt.getTime() + TRIAL_DAYS * DAY_MS).toISOString()
      : null;
  return {
    state,
    reason,
    entitlement,
    trial: { active: entitlement.trial.active, endsAt: entitlement.trial.endsAt, chargeDate },
    plan: planOf(entitlement, row),
    emailMasked: maskEmail(row?.email ?? viewer.billing.email),
    reference: shortReference(params.subscription_id ?? (entitlement.entitled ? viewer.billing.subscriptionId : null) ?? row?.pendingCheckoutSessionId ?? null),
    waitedMs: pendingAt ? Math.max(0, Math.round(now.getTime() - pendingAt.getTime())) : 0,
  };
}

/** getActivation with how it got there (the route's telemetry). */
export async function resolveActivation(
  viewer: Viewer,
  params: ActivationQuery,
  opts: { dodo: boolean; now: Date },
  deps?: ActivationDeps,
): Promise<ActivationResult> {
  const now = opts.now;
  if (viewer.entitlement.entitled) {
    return { data: activationData("active", null, viewer.entitlement, viewer, null, params, now), via: "db", dodoCalled: false };
  }
  const d = deps ?? (await defaultActivationDeps());
  const row = await d.readRow(viewer.id);
  const pendingAt = row?.pendingCheckoutAt ?? null;
  const answer = (state: ActivationData["state"], reason: ActivationData["reason"], entitlement: Entitlement, via: ActivationVia, dodoCalled: boolean) => ({
    data: activationData(state, reason, entitlement, viewer, row, params, now),
    via,
    dodoCalled,
  });

  // A decline recorded after this checkout started. It is the answer unless the caller can prove a later success on
  // the same Dodo page (a second card accepted): Dodo's return carries the subscription_id, Check Again sends
  // force=1. Those still ask Dodo, at once (a decline already happened, nothing to wait for), so a member who paid on
  // the second attempt is never stuck at "failed" when the success webhook is late or lost (FIX-1).
  const declined = !!(row?.lastPaymentFailedAt && pendingAt && row.lastPaymentFailedAt.getTime() > pendingAt.getTime());
  const force = params.force === "1";
  const notActive = (dodoCalled: boolean) =>
    declined ? answer("failed", "declined", viewer.entitlement, null, dodoCalled) : answer("pending", null, viewer.entitlement, null, dodoCalled);
  if (declined && !(force || params.subscription_id)) return notActive(false);

  const waitedEnough = declined || !pendingAt || now.getTime() - pendingAt.getTime() > ACTIVATION_DODO_AFTER_MS;
  if (!opts.dodo || !row || !waitedEnough || !(params.subscription_id || row.pendingCheckoutSessionId)) {
    return notActive(false);
  }
  if (!force && !(await d.allowDodoCheck(viewer.clerkUserId))) return notActive(false);

  const api = await d.dodo();
  if (!api) {
    if (force) throw new ApiError("not_configured", { message: "Billing is not configured.", details: { provider: "dodo" } });
    return notActive(false);
  }

  try {
    if (params.subscription_id) {
      const sub = await api.retrieveSubscription(params.subscription_id);
      if (!ownsSubscription(sub, viewer, row)) {
        d.warn("[billing] activation: subscription of another user ignored", { user: viewer.ref });
        return notActive(true);
      }
      if (sub.status === "failed") return answer("failed", "declined", viewer.entitlement, null, true);
      const outcome = await d.apply(sub, { source: "api", userId: viewer.id, eventTime: providerTimeOf(sub) });
      // A duplicate (FIX-2) is not applied, but the member is entitled through the subscription the row holds.
      if ((outcome.status === "applied" || outcome.status === "stale" || outcome.status === "duplicate") && outcome.entitlement.entitled) {
        return answer("active", null, d.toWire(outcome.entitlement, viewer, now), "self_heal", true);
      }
      return notActive(true);
    }
    const session = await api.retrieveCheckoutSession(row.pendingCheckoutSessionId!);
    if (session.paymentStatus === "failed") return answer("failed", "declined", viewer.entitlement, null, true);
    if (session.paymentStatus === "cancelled") return answer("failed", "cancelled", viewer.entitlement, null, true);
    if (session.paymentStatus === "succeeded") {
      const summary = await d.refresh(viewer, now);
      if (summary?.entitled) return answer("active", null, d.toWire(summary, viewer, now), "self_heal", true);
    }
    return notActive(true);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (force) throw new ApiError("upstream_unavailable", { details: { provider: "dodo", kind: dodoErrorKind(err) } });
    d.warn("[billing] activation: Dodo check failed", { user: viewer.ref, error: err instanceof Error ? err.name : "unknown" });
    return notActive(true);
  }
}

/** Plan 8.5.1 (signatures.md §3.2): the activation answer. Never sets cookies. */
export async function getActivation(
  viewer: Viewer,
  params: ActivationQuery,
  opts: { dodo: boolean; now: Date },
  deps?: ActivationDeps,
): Promise<ActivationData> {
  return (await resolveActivation(viewer, params, opts, deps)).data;
}

async function defaultActivationDeps(): Promise<ActivationDeps> {
  const [{ prisma }, { logger }, { getDodoApi }, { entitlementOf, isPaywallEnabled }] = await Promise.all([
    import("@/lib/prisma"),
    import("@/lib/logger"),
    import("@/lib/billing/dodo-api"),
    import("@/lib/auth/membership"),
  ]);
  return {
    async readRow(userId) {
      const rows = await prisma.$queryRawUnsafe<ActivationRow[]>(ACTIVATION_ROW_SQL, userId);
      const r = rows[0];
      if (!r || typeof r.email !== "string") return null;
      return {
        email: r.email,
        dodoCustomerId: r.dodoCustomerId ?? null,
        subscriptionProductId: r.subscriptionProductId ?? null,
        pendingCheckoutSessionId: r.pendingCheckoutSessionId ?? null,
        pendingCheckoutPlan: r.pendingCheckoutPlan ?? null,
        pendingCheckoutAt: r.pendingCheckoutAt ?? null,
        trialOfferedAt: r.trialOfferedAt ?? null,
        lastPaymentFailedAt: r.lastPaymentFailedAt ?? null,
      };
    },
    dodo: () => getDodoApi(),
    async allowDodoCheck(clerkUserId) {
      const { checkRateLimit } = await import("@/lib/rate-limit-db");
      return (await checkRateLimit([DODO_ACTIVATION_LIMIT], { clerkUserId, ip: null })).allowed;
    },
    apply: async (snapshot, options) => (await import("@/lib/billing/entitlement")).applySubscriptionSnapshot(snapshot, options),
    async refresh(viewer, now) {
      const { defaultRefreshDeps, getBillingProvider, refreshMembership } = await import("@/lib/billing/refresh");
      const provider = await getBillingProvider();
      if (!provider) return null;
      const result = await refreshMembership(
        {
          userId: viewer.id,
          email: viewer.billing.email,
          dodoCustomerId: viewer.billing.dodoCustomerId,
          subscriptionProductId: viewer.billing.subscriptionProductId,
          stored: viewer.billing.summary,
        },
        await defaultRefreshDeps(provider, now),
      );
      return result.refreshed ? result.summary : null;
    },
    toWire: (summary, viewer, now) =>
      entitlementOf(summary, {
        role: viewer.role === "admin" ? "ADMIN" : "USER",
        dodoCustomerId: viewer.billing.dodoCustomerId,
        now,
        paywallEnabled: isPaywallEnabled(),
      }),
    warn(message, context) {
      try {
        logger.warn(message, context);
      } catch {
        // Logging never fails the poll.
      }
    },
  };
}
