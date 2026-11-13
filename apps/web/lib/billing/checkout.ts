// BIL-1's logic (phase-04 plan 7.5.1, 8.4, 8.5; D4-15, D4-19, D4-29); the route (app/api/checkout/route.ts) adds the
// Idempotency-Key replay around it.
//
//   1. entitled → 409 already_subscribed;
//   2. one read of the user: the email and name come from the users row, never from the request or Clerk;
//   3. the live Dodo guard (subscriptions.list) runs only when the row has a Dodo customer AND a non-terminal status
//      (saves ≈ 400 ms on first checkouts): an active one → 409 already_subscribed, on_hold / past_due → 402
//      payment_update_required (fix the card instead of buying twice); a Dodo failure here does not block;
//   4. the trial: eligible on the row (never trialled, never subscribed) AND no trial-ledger hit on the email or a
//      verified handle (8.4.3; a hit is reported as the `trial_ledger_hit` fraud signal);
//   5. checkoutSessions.create with metadata {clerkUserId, userRef, plan, trial, source} and the return URL by source
//      (buildActivationReturnUrl: `/onboarding/activating` with onboarding-v3 on, else `/checkout/activating`);
//   6. one UPDATE records pendingCheckout* + lastCheckoutSource, trialOfferedAt when a trial was offered, and moves
//      onboardingStep monotonically to ACTIVATING for `source: onboarding` (D4-15);
//   7. CheckoutData (chargeDate = now + 7 d with a trial, else null).
// Session reuse (BIL-1, plan §3 row 190; FIX-2): a checkout for the SAME plan within PENDING_CHECKOUT_TTL_MS of the
// last one, whose Dodo session is still open (no payment yet, or one still in progress), answers that session again
// (its page, its trial offer and charge date) instead of opening a second one: two tabs never hold two trial
// sessions for one plan. A paid session is already_subscribed (FIX-1); a failed or cancelled one, another plan, an
// older one or a Dodo that cannot say opens a new session. If two sessions are paid anyway (two plans in two tabs),
// the second subscription is never applied on any path and is cancelled before it charges (entitlement.ts,
// dodo-events.ts; docs/decisions.md FX-13, FX-14).
// Dodo failures are `502 upstream_unavailable {provider: "dodo", kind}` (never the raw message); no API key, a refused
// DODO_API_BASE_URL or no product id is `503 not_configured`. Dependencies are injected (checkout.test.ts and the
// contract tests run without Dodo or Postgres).
// D5: Dodo locks the checkout's Full Name to what we send: a real name or none, never "Anonymous User".
import { realName } from "@/lib/onboarding/display-name";
import type { CheckoutBody, CheckoutData } from "@repo/contracts/http/billing";
import { ONBOARDING_STEPS_DB, PENDING_CHECKOUT_TTL_MS } from "@repo/contracts/http/p04-plain";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { dodoErrorKind, type DodoApi } from "./dodo-api";
import { DodoBaseUrlRefusedError } from "./dodo-env";
import { BILLING_PLANS, type PlanKey } from "./plans";
import { buildActivationReturnUrl } from "./return-url";
import type { LedgerHandle, LedgerHit } from "./trial-ledger";
import { TRIAL_DAYS, decideTrial } from "./trial-rules";

const DAY_MS = 86_400_000;

/** Statuses for which Dodo may still hold a live subscription for this customer (step 3). */
export const LIVE_GUARD_STATUSES: ReadonlySet<string> = new Set(["active", "on_hold", "past_due", "paused", "pending"]);

export type CheckoutUser = {
  email: string;
  name: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  dodoCustomerId: string | null;
  handles: LedgerHandle[];
  /** The last checkout this user started (FIX-1: a paid one blocks a second session). Optional for hand-built rows. */
  pendingCheckoutSessionId?: string | null;
  pendingCheckoutAt?: Date | null;
  /** FIX-2 session reuse: its plan, its Dodo page, and whether it offered the trial (trialOfferedAt = its time). */
  pendingCheckoutPlan?: string | null;
  pendingCheckoutUrl?: string | null;
  trialOfferedAt?: Date | null;
};

/** Step 2: the user and the handles of their links (for the ledger probe), one statement. */
export const CHECKOUT_USER_SQL = `SELECT u.email, u.name, u."trialStartedAt", u."trialEndsAt", u."subscriptionId", u."subscriptionStatus",
       u."dodoCustomerId", u."pendingCheckoutSessionId", u."pendingCheckoutAt", u."pendingCheckoutPlan", u."pendingCheckoutUrl",
       u."trialOfferedAt",
       COALESCE((SELECT json_agg(json_build_object('provider', lower(la.provider::text), 'usernameLower', la."usernameLower",
                                                   'verified', la."verifiedAt" IS NOT NULL) ORDER BY la.id)
                   FROM linked_accounts la WHERE la."userId" = u.id), '[]'::json) AS handles
FROM users u WHERE u.id = $1`;

/**
 * Step 6, one statement. `$6` = a trial was offered; the step only moves forward (D4-15): ACTIVATING replaces an
 * earlier step, never DONE. `$7` is the DB step order (CT ONBOARDING_STEPS_DB).
 */
export const CHECKOUT_RECORD_SQL = `UPDATE users SET
  "pendingCheckoutSessionId" = $2,
  "pendingCheckoutPlan"      = $3,
  "pendingCheckoutAt"        = $4::timestamp(3),
  "pendingCheckoutUrl"       = $8,
  "lastCheckoutSource"       = $5,
  "trialOfferedAt"           = CASE WHEN $6::boolean THEN $4::timestamp(3) ELSE "trialOfferedAt" END,
  "onboardingStep"           = CASE WHEN $5::text = 'onboarding'
                                     AND array_position($7::text[], 'ACTIVATING') > array_position($7::text[], "onboardingStep"::text)
                                    THEN 'ACTIVATING'::"OnboardingStep" ELSE "onboardingStep" END,
  "updatedAt"                = $4::timestamp(3)
WHERE id = $1`;

export type CheckoutRecord = {
  userId: bigint;
  sessionId: string;
  plan: PlanKey;
  at: Date;
  source: CheckoutBody["source"];
  trial: boolean;
  checkoutUrl: string;
};

/**
 * A reused session (FIX-2): only the source and the monotonic onboarding step move; the session, its time and its
 * trial offer stay as recorded (the reuse window never extends itself). `$4` is the DB step order.
 */
export const CHECKOUT_REUSE_SQL = `UPDATE users SET
  "lastCheckoutSource" = $2,
  "onboardingStep"     = CASE WHEN $2::text = 'onboarding'
                               AND array_position($4::text[], 'ACTIVATING') > array_position($4::text[], "onboardingStep"::text)
                              THEN 'ACTIVATING'::"OnboardingStep" ELSE "onboardingStep" END,
  "updatedAt"          = $3::timestamp(3)
WHERE id = $1`;

export interface CheckoutDeps {
  readUser(userId: bigint): Promise<CheckoutUser | null>;
  /** null without DODO_PAYMENTS_API_KEY; throws DodoBaseUrlRefusedError on a refused override. */
  dodo(): Promise<DodoApi | null>;
  /** products.ts getProductIdForPlan; null when the plan's product id is not configured. */
  productId(plan: PlanKey): Promise<string | null>;
  checkLedger(input: { email: string; handles: LedgerHandle[] }): Promise<LedgerHit>;
  onboardingV3(viewer: Viewer): Promise<boolean>;
  record(input: CheckoutRecord): Promise<void>;
  /** CHECKOUT_REUSE_SQL. */
  recordReuse(input: { userId: bigint; source: CheckoutBody["source"]; at: Date }): Promise<void>;
  /** The app origin Dodo returns to (DODO_PAYMENTS_RETURN_URL's origin, else the canonical site). */
  origin(): string;
  /** Server event `trial_ledger_hit` (scheduled after the response). */
  ledgerHit(kind: "email" | "handle", viewer: Viewer): void;
  warn(message: string): void;
}

function notConfigured(): ApiError {
  return new ApiError("not_configured", { message: "This plan is not available right now.", details: { provider: "dodo" } });
}

async function liveGuard(api: DodoApi, customerId: string, warn: (m: string) => void): Promise<void> {
  let subscriptions;
  try {
    subscriptions = await api.listSubscriptions(customerId);
  } catch {
    warn("billing.checkout_guard_unreachable");
    return;
  }
  if (subscriptions.some((s) => s.status === "active")) throw new ApiError("already_subscribed");
  if (subscriptions.some((s) => s.status === "on_hold" || s.status === "past_due")) {
    throw new ApiError("payment_update_required", { details: { portalUrl: "/api/customer-portal" } });
  }
}

/**
 * FIX-1: two checkouts at once (two tabs or devices; a ledger hit or a returning lapsed buyer, so no trial and no live
 * subscription on the row yet). When the checkout this user started in the last PENDING_CHECKOUT_TTL_MS is already
 * paid at Dodo (its webhook not yet applied), a second session would charge again: 409 already_subscribed, and the
 * activation page picks the first one up. An open, failed or cancelled session does not block a retry. Dodo
 * unreachable → allowed (the webhook's duplicate guard still cancels a second paid subscription, dodo-events.ts).
 */
/** Payment statuses of a session the user can still finish on its page (nothing charged, nothing refused yet). */
const OPEN_SESSION_STATUSES: ReadonlySet<string | null> = new Set([
  null,
  "requires_payment_method",
  "requires_confirmation",
  "requires_customer_action",
  "requires_merchant_action",
  "requires_capture",
  "processing",
]);

/**
 * The checkout this user started in the last PENDING_CHECKOUT_TTL_MS, asked at Dodo once: "paid" (FIX-1: a second
 * session would charge again → 409), "open" (FIX-2: reusable for the same plan), else "none" (none recent, failed,
 * cancelled, or Dodo unreachable: a new session; the webhook's duplicate guard still covers two paid ones).
 */
async function pendingSessionState(api: DodoApi, user: CheckoutUser, now: Date, warn: (m: string) => void): Promise<"paid" | "open" | "none"> {
  const id = user.pendingCheckoutSessionId;
  const at = user.pendingCheckoutAt;
  if (!id || !at || now.getTime() - at.getTime() > PENDING_CHECKOUT_TTL_MS) return "none";
  let status: string | null;
  try {
    status = (await api.retrieveCheckoutSession(id)).paymentStatus;
  } catch {
    warn("billing.checkout_paid_guard_unreachable");
    return "none";
  }
  if (status === "succeeded") return "paid";
  return OPEN_SESSION_STATUSES.has(status) ? "open" : "none";
}

/** The open session to answer again for `plan`, or null (FIX-2 session reuse). */
function reusableSession(user: CheckoutUser, plan: PlanKey): { sessionId: string; checkoutUrl: string; at: Date; trial: boolean } | null {
  const { pendingCheckoutSessionId: id, pendingCheckoutUrl: url, pendingCheckoutAt: at, pendingCheckoutPlan } = user;
  if (!id || !url || !at || pendingCheckoutPlan !== plan) return null;
  // The trial this session offered: recorded in the same UPDATE as its time (CHECKOUT_RECORD_SQL), and only while the
  // row still has never trialled.
  const trial = !!user.trialOfferedAt && user.trialOfferedAt.getTime() === at.getTime() && !user.trialStartedAt;
  return { sessionId: id, checkoutUrl: url, at, trial };
}

export async function startCheckout(viewer: Viewer, body: CheckoutBody, now: Date, deps: CheckoutDeps): Promise<CheckoutData> {
  if (viewer.entitlement.entitled) throw new ApiError("already_subscribed");

  const user = await deps.readUser(viewer.id);
  if (!user) throw new ApiError("unauthorized");

  let api: DodoApi | null;
  try {
    api = await deps.dodo();
  } catch (err) {
    if (err instanceof DodoBaseUrlRefusedError) {
      deps.warn("billing.dodo_base_url_refused");
      throw notConfigured();
    }
    throw err;
  }
  const productId = await deps.productId(body.plan);
  if (!api || !productId) throw notConfigured();

  if (user.dodoCustomerId && user.subscriptionStatus && LIVE_GUARD_STATUSES.has(user.subscriptionStatus)) {
    await liveGuard(api, user.dodoCustomerId, deps.warn);
  }
  const pending = await pendingSessionState(api, user, now, deps.warn);
  if (pending === "paid") throw new ApiError("already_subscribed");
  const reuse = pending === "open" ? reusableSession(user, body.plan) : null;
  if (reuse) {
    await deps.recordReuse({ userId: viewer.id, source: body.source, at: now });
    return checkoutData(body.plan, reuse.sessionId, reuse.checkoutUrl, reuse.trial, reuse.at);
  }

  const decision = await decideTrial(user, () => deps.checkLedger({ email: user.email, handles: user.handles }));
  if (!decision.trial && decision.reason === "ledger") deps.ledgerHit(decision.kind, viewer);
  const trial = decision.trial;

  const onboardingV3 = body.source === "onboarding" ? await deps.onboardingV3(viewer) : false;
  const returnUrl = buildActivationReturnUrl(body.source, body.returnPath, deps.origin(), { onboardingV3, plan: body.plan });

  let session: { sessionId: string; checkoutUrl: string };
  try {
    session = await api.createCheckoutSession({
      productId,
      customer: user.dodoCustomerId ? { customerId: user.dodoCustomerId } : { email: user.email, name: realName(user.name) ?? undefined },
      metadata: { clerkUserId: viewer.clerkUserId, userRef: viewer.ref, plan: body.plan, trial: trial ? "yes" : "no", source: body.source },
      trialDays: trial ? TRIAL_DAYS : null,
      returnUrl,
      theme: body.theme ?? "system",
    });
  } catch (err) {
    deps.warn(`billing.checkout_create_failed:${err instanceof Error ? err.name : "unknown"}`);
    throw new ApiError("upstream_unavailable", { details: { provider: "dodo", kind: dodoErrorKind(err) } });
  }

  await deps.record({
    userId: viewer.id,
    sessionId: session.sessionId,
    plan: body.plan,
    at: now,
    source: body.source,
    trial,
    checkoutUrl: session.checkoutUrl,
  });
  return checkoutData(body.plan, session.sessionId, session.checkoutUrl, trial, now);
}

/** CheckoutData for a session started at `startedAt` (the charge date counts from the session's own start). */
function checkoutData(planKey: PlanKey, sessionId: string, checkoutUrl: string, trial: boolean, startedAt: Date): CheckoutData {
  const plan = BILLING_PLANS[planKey];
  return {
    checkoutUrl,
    sessionId,
    trial,
    chargeDate: trial ? new Date(startedAt.getTime() + TRIAL_DAYS * DAY_MS).toISOString() : null,
    priceCents: plan.priceCents,
    currency: "USD",
    interval: plan.interval,
  };
}

/** Production dependencies (Prisma, Dodo, flags, PostHog), loaded lazily so route modules import under plain Node. */
export async function defaultCheckoutDeps(opts: {
  env: Readonly<Record<string, string | undefined>>;
  after: (task: () => unknown) => void;
  log: (level: "warn" | "error", message: string) => void;
}): Promise<CheckoutDeps> {
  const [{ prisma }, { getDodoApi }, { resolveAppOrigin }, { BASE_URL }] = await Promise.all([
    import("@/lib/prisma"),
    import("./dodo-api"),
    import("./return-url"),
    import("@/lib/seo"),
  ]);
  return {
    async readUser(userId) {
      const rows = await prisma.$queryRawUnsafe<CheckoutUser[]>(CHECKOUT_USER_SQL, userId);
      return rows[0] ?? null;
    },
    dodo: () => getDodoApi(opts.env),
    async productId(plan) {
      const { BillingNotConfiguredError, getProductIdForPlan } = await import("./products");
      try {
        return getProductIdForPlan(plan);
      } catch (err) {
        if (err instanceof BillingNotConfiguredError) return null;
        throw err;
      }
    },
    async checkLedger(input) {
      const { checkTrialLedger } = await import("./trial-ledger");
      return checkTrialLedger(prisma, input);
    },
    async onboardingV3(viewer) {
      const { getFlags } = await import("@/lib/flags");
      return (await getFlags(viewer))["onboarding-v3"] === true;
    },
    async record(r) {
      await prisma.$executeRawUnsafe(
        CHECKOUT_RECORD_SQL,
        r.userId,
        r.sessionId,
        r.plan,
        r.at.toISOString(),
        r.source,
        r.trial,
        [...ONBOARDING_STEPS_DB],
        r.checkoutUrl.slice(0, 512),
      );
    },
    async recordReuse(r) {
      await prisma.$executeRawUnsafe(CHECKOUT_REUSE_SQL, r.userId, r.source, r.at.toISOString(), [...ONBOARDING_STEPS_DB]);
    },
    origin: () => resolveAppOrigin({ DODO_PAYMENTS_RETURN_URL: opts.env.DODO_PAYMENTS_RETURN_URL }, BASE_URL),
    ledgerHit(kind, viewer) {
      opts.after(async () => {
        const { captureBillingServerEvent } = await import("./server-events");
        await captureBillingServerEvent("trial_ledger_hit", { kind }, viewer.ref);
      });
    },
    warn: (message) => opts.log("warn", message),
  };
}
