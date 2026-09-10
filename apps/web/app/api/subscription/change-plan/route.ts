import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { dodo } from "@/lib/dodo"
import { logger } from "@/lib/logger"
import { BILLING_PLANS, PLAN_KEYS } from "@/lib/billing/plans"
import {
  decidePlanChange,
  isPlanChangeRejection,
} from "@/lib/billing/subscription-action-rules"
import {
  buildChangePlanParams,
  describeDodoError,
  errorResponse,
  getOwnedSubscription,
  respondAfterMutation,
  summarizeScheduledChange,
} from "@/lib/billing/subscription-actions"

const changePlanBodySchema = z.object({
  plan: z.enum(PLAN_KEYS),
})

/**
 * GET: the plan change currently scheduled on the member's subscription (a
 * downgrade waiting for the renewal date), or null.
 */
export async function GET() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await getOwnedSubscription(userId)
  if (!result.ok) return errorResponse(result.error)

  return NextResponse.json({
    scheduledChange: summarizeScheduledChange(result.owned.subscription.scheduled_change),
  })
}

/**
 * POST: move the member's subscription to another plan.
 *
 * Upgrades (monthly -> yearly, legacy -> anything) apply immediately with the
 * unused part of the current period credited. Downgrades (yearly -> monthly)
 * are scheduled for the renewal date so nothing already paid for is lost.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = changePlanBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a monthly or yearly plan" },
      { status: 400 },
    )
  }

  const result = await getOwnedSubscription(userId)
  if (!result.ok) return errorResponse(result.error)
  const { owned } = result

  const decision = decidePlanChange(
    owned.planKey,
    owned.subscription.status,
    parsed.data.plan,
  )
  if (isPlanChangeRejection(decision)) {
    return NextResponse.json(
      { error: decision.message, code: decision.code },
      { status: decision.status },
    )
  }

  let paymentLink: string | null = null
  try {
    const response = await dodo.subscriptions.changePlan(
      owned.subscription.subscription_id,
      buildChangePlanParams(decision),
    )
    paymentLink = response.payment_link ?? null
  } catch (err) {
    return errorResponse(describeDodoError(err, "change your plan"))
  }

  logger.info(
    `[billing] user ${owned.user.id} ${decision.kind} ${owned.planKey ?? "unknown"} -> ${decision.target} (${decision.effectiveAt})`,
  )
  const target = BILLING_PLANS[decision.target]
  const message = paymentLink
    ? "Complete the payment to finish switching plans."
    : decision.kind === "downgrade"
      ? `You will switch to the ${target.label.toLowerCase()} plan on your next renewal date.`
      : `You are now on the ${target.label.toLowerCase()} plan.`
  return respondAfterMutation(owned, message, ({ subscription }) => ({
    change: { target: decision.target, kind: decision.kind, effectiveAt: decision.effectiveAt },
    scheduledChange: summarizeScheduledChange(subscription.scheduled_change),
    paymentLink,
  }))
}

/** DELETE: cancel a scheduled (not yet applied) plan change. */
export async function DELETE() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await getOwnedSubscription(userId)
  if (!result.ok) return errorResponse(result.error)
  const { owned } = result

  if (!owned.subscription.scheduled_change) {
    return NextResponse.json(
      { error: "No plan change is scheduled.", code: "no_scheduled_change" },
      { status: 409 },
    )
  }

  try {
    await dodo.subscriptions.cancelChangePlan(owned.subscription.subscription_id)
  } catch (err) {
    return errorResponse(describeDodoError(err, "cancel the scheduled plan change"))
  }

  return respondAfterMutation(
    owned,
    "Your scheduled plan change has been cancelled.",
    ({ subscription }) => ({
      scheduledChange: summarizeScheduledChange(subscription.scheduled_change),
    }),
  )
}
