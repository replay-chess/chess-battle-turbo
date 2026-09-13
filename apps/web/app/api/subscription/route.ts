import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { dodo } from "@/lib/dodo"
import { logger } from "@/lib/logger"
import {
  ENTITLEMENT_SELECT,
  applySubscriptionSnapshot,
  summarizeUserEntitlement,
  type EntitlementSummary,
} from "@/lib/billing/entitlement"
import { pickPrimarySubscription } from "@/lib/billing/entitlement-rules"
import { isPaywallEnabled } from "@/lib/auth/require-subscription"

const USER_SELECT = {
  id: true,
  email: true,
  dodoCustomerId: true,
  ...ENTITLEMENT_SELECT,
} as const

export interface SubscriptionResponse extends EntitlementSummary {
  customerId?: string
  /** False when BILLING_PAYWALL=off; clients then skip their own gate. */
  paywall: boolean
  /** Kept for older clients; mirrors `entitled` and `subscriptionId`. */
  subscription?: {
    id: string
    status: string
    productId: string | null
    nextBillingDate: string | null
    planKey: EntitlementSummary["planKey"]
    interval: EntitlementSummary["interval"]
    priceCents: number | null
  }
}

function toResponse(
  summary: EntitlementSummary,
  customerId: string | null | undefined,
  productId: string | null,
): SubscriptionResponse {
  return {
    ...summary,
    customerId: customerId ?? undefined,
    paywall: isPaywallEnabled(),
    subscription:
      summary.subscriptionId && summary.status
        ? {
            id: summary.subscriptionId,
            status: summary.status,
            productId,
            nextBillingDate: summary.currentPeriodEnd,
            planKey: summary.planKey,
            interval: summary.interval,
            priceCents: summary.priceCents,
          }
        : undefined,
  }
}

/**
 * Returns the signed-in user's entitlement.
 *
 * Dodo is the source of truth, so the route refreshes from the Dodo API and
 * persists the result on the user row. If Dodo is unreachable it falls back to
 * what is stored, so a billing outage never locks paying members out.
 */
export async function GET() {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { googleId: clerkUserId },
    select: USER_SELECT,
  })
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  let customerId = user.dodoCustomerId

  // Self-heal: link the Dodo customer by email when the webhook has not yet.
  if (!customerId && user.email) {
    try {
      for await (const customer of dodo.customers.list({ email: user.email })) {
        customerId = customer.customer_id
        break
      }
      if (customerId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { dodoCustomerId: customerId },
        })
      }
    } catch (error) {
      logger.warn(
        `[subscription] Customer lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const stored = toResponse(
    summarizeUserEntitlement(user),
    customerId,
    user.subscriptionProductId,
  )

  if (!customerId) {
    return NextResponse.json(stored)
  }

  try {
    const subscriptions = []
    for await (const subscription of dodo.subscriptions.list({
      customer_id: customerId,
    })) {
      subscriptions.push(subscription)
    }

    const primary = pickPrimarySubscription(subscriptions)
    if (!primary) {
      return NextResponse.json(stored)
    }

    const summary = await applySubscriptionSnapshot(primary, {
      source: "api",
      userId: user.id,
    })
    return NextResponse.json(
      toResponse(summary ?? stored, customerId, primary.product_id),
    )
  } catch (error) {
    logger.warn(
      `[subscription] Dodo lookup failed, using stored entitlement: ${error instanceof Error ? error.message : String(error)}`,
    )
    return NextResponse.json(stored)
  }
}
