import "server-only";
import { NextResponse } from "next/server";
import { APIError } from "dodopayments";
import type {
  ScheduledPlanChange,
  Subscription,
  SubscriptionChangePlanParams,
} from "dodopayments/resources/subscriptions";
import { prisma } from "@/lib/prisma";
import { dodo } from "@/lib/dodo";
import { logger } from "@/lib/logger";
import {
  ENTITLEMENT_SELECT,
  applySubscriptionSnapshot,
  summarizeUserEntitlement,
  type EntitlementSummary,
} from "./entitlement";
import { resolvePlanFromProductId } from "./plans";
import { BillingNotConfiguredError, getProductCatalog, getProductIdForPlan } from "./products";
import type { CurrentPlanKey, PlanChange } from "./subscription-action-rules";

export type { Subscription };

/** A failure the route should turn into a JSON response. */
export interface ActionError {
  status: number;
  message: string;
  code?: string;
}

export interface OwnedSubscription {
  user: {
    id: bigint;
    dodoCustomerId: string | null;
  };
  /** Fresh from Dodo. */
  subscription: Subscription;
  /** Plan the subscription's product maps to, or null for an unknown product. */
  planKey: CurrentPlanKey;
}

export type OwnedSubscriptionResult =
  | { ok: true; owned: OwnedSubscription }
  | { ok: false; error: ActionError };

/** Client-facing view of a pending plan change. */
export interface ScheduledChangeSummary {
  productId: string;
  planKey: CurrentPlanKey;
  effectiveAt: string;
}

export function summarizeScheduledChange(
  change: ScheduledPlanChange | null | undefined,
): ScheduledChangeSummary | null {
  if (!change) return null;
  return {
    productId: change.product_id,
    planKey: resolvePlanFromProductId(change.product_id, getProductCatalog())?.planKey ?? null,
    effectiveAt: change.effective_at,
  };
}

/**
 * Loads the signed-in user's subscription from Dodo and proves it belongs to
 * them: the subscription's customer must match the Dodo customer linked to the
 * user row. Without that check a user could act on any subscription ID that
 * happened to be stored against their account.
 */
export async function getOwnedSubscription(clerkUserId: string): Promise<OwnedSubscriptionResult> {
  const user = await prisma.user.findUnique({
    where: { googleId: clerkUserId },
    select: { id: true, email: true, dodoCustomerId: true, ...ENTITLEMENT_SELECT },
  });
  if (!user) {
    return { ok: false, error: { status: 404, message: "User not found" } };
  }
  if (!user.subscriptionId) {
    return {
      ok: false,
      error: {
        status: 404,
        code: "no_subscription",
        message: "You do not have a subscription yet.",
      },
    };
  }

  let subscription: Subscription;
  try {
    subscription = await dodo.subscriptions.retrieve(user.subscriptionId);
  } catch (err) {
    return { ok: false, error: describeDodoError(err, "load your subscription") };
  }

  let customerId = user.dodoCustomerId;

  // Self-heal: the webhook may not have linked the Dodo customer yet. The
  // subscription's customer email proving to be the user's own is the same
  // evidence applySubscriptionSnapshot accepts.
  if (
    !customerId &&
    user.email &&
    subscription.customer.email.toLowerCase() === user.email.toLowerCase()
  ) {
    customerId = subscription.customer.customer_id;
    await prisma.user.update({
      where: { id: user.id },
      data: { dodoCustomerId: customerId },
    });
  }

  if (!customerId || subscription.customer.customer_id !== customerId) {
    logger.warn(
      `[billing] Subscription ${subscription.subscription_id} customer ${subscription.customer.customer_id} does not match user ${user.id} (${user.dodoCustomerId ?? "no customer"})`,
    );
    return {
      ok: false,
      error: {
        status: 403,
        message: "This subscription is not linked to your account.",
      },
    };
  }

  return {
    ok: true,
    owned: {
      user: { id: user.id, dodoCustomerId: customerId },
      subscription,
      planKey: resolvePlanFromProductId(subscription.product_id, getProductCatalog())?.planKey ?? null,
    },
  };
}

/**
 * Re-reads the subscription after a mutation and persists it on the user row,
 * so the client can update its store from the response without waiting for
 * the webhook.
 */
export async function refreshEntitlement(owned: OwnedSubscription): Promise<{
  entitlement: EntitlementSummary;
  subscription: Subscription;
}> {
  const subscription = await dodo.subscriptions.retrieve(owned.subscription.subscription_id);
  const entitlement =
    (await applySubscriptionSnapshot(subscription, {
      source: "api",
      userId: owned.user.id,
    })) ??
    summarizeUserEntitlement(
      await prisma.user.findUniqueOrThrow({
        where: { id: owned.user.id },
        select: ENTITLEMENT_SELECT,
      }),
    );
  return { entitlement, subscription };
}

/**
 * Completes a mutation route: refreshes the entitlement and builds the JSON
 * body. If the refresh itself fails the change has still been made, so the
 * client is told to refetch (`refresh_failed`) rather than retry the mutation.
 */
export async function respondAfterMutation(
  owned: OwnedSubscription,
  message: string,
  extra: (refreshed: { subscription: Subscription }) => Record<string, unknown> = () => ({}),
): Promise<NextResponse> {
  try {
    const refreshed = await refreshEntitlement(owned);
    return NextResponse.json({
      entitlement: refreshed.entitlement,
      message,
      ...extra(refreshed),
    });
  } catch (err) {
    logger.error(
      `[billing] Change applied to ${owned.subscription.subscription_id} but refresh failed`,
      err,
    );
    return NextResponse.json(
      {
        error: "Your change was saved but we could not refresh it yet. Reload to see the update.",
        code: "refresh_failed",
      },
      { status: 502 },
    );
  }
}

/** Body shared by `changePlan` and `previewChangePlan`. */
export function buildChangePlanParams(change: PlanChange): SubscriptionChangePlanParams {
  return {
    product_id: getProductIdForPlan(change.target),
    quantity: 1,
    proration_billing_mode: change.prorationBillingMode,
    effective_at: change.effectiveAt,
    on_payment_failure: "prevent_change",
    // A member who scheduled a downgrade and then upgrades (or vice versa)
    // should not be blocked by the pending schedule.
    cancel_scheduled_change_plan: true,
  };
}

/**
 * Turns an error from the Dodo SDK into a status + message. Client errors
 * (4xx) are passed through so the member sees Dodo's own explanation, for
 * example a declined card; everything else becomes a 502.
 */
export function describeDodoError(err: unknown, action: string): ActionError {
  if (err instanceof BillingNotConfiguredError) {
    logger.error(`[billing] ${err.message}`);
    return { status: 503, message: "This plan is not available right now." };
  }
  if (err instanceof APIError && typeof err.status === "number") {
    const body = err.error as { message?: unknown; code?: unknown } | undefined;
    const message =
      typeof body?.message === "string" && body.message.length > 0
        ? body.message
        : err.message.replace(/^\d{3}\s+/, "");
    // Auth failures against Dodo mean our API key is wrong, not the member.
    if (err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403) {
      logger.warn(`[billing] Dodo rejected ${action}: ${err.status} ${message}`);
      return {
        status: err.status,
        message,
        code: typeof body?.code === "string" ? body.code : undefined,
      };
    }
    logger.error(`[billing] Dodo failed to ${action}: ${err.status} ${message}`, err);
    return { status: 502, message: `Our billing provider could not ${action}. Please try again.` };
  }
  logger.error(`[billing] Unexpected error trying to ${action}`, err);
  return { status: 502, message: `We could not ${action}. Please try again.` };
}

export function errorResponse(error: ActionError): NextResponse {
  return NextResponse.json(
    { error: error.message, ...(error.code ? { code: error.code } : {}) },
    { status: error.status },
  );
}
