import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { dodo } from "@/lib/dodo"
import { logger } from "@/lib/logger"
import { resumeRejection } from "@/lib/billing/subscription-action-rules"
import {
  describeDodoError,
  errorResponse,
  getOwnedSubscription,
  respondAfterMutation,
} from "@/lib/billing/subscription-actions"

/** POST: undo a cancellation scheduled for the end of the period. */
export async function POST() {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await getOwnedSubscription(userId)
  if (!result.ok) return errorResponse(result.error)
  const { owned } = result

  const rejection = resumeRejection(
    owned.subscription.status,
    owned.subscription.cancel_at_next_billing_date,
  )
  if (rejection) {
    return NextResponse.json({ error: rejection.message }, { status: rejection.status })
  }

  try {
    await dodo.subscriptions.update(owned.subscription.subscription_id, {
      cancel_at_next_billing_date: false,
    })
  } catch (err) {
    return errorResponse(describeDodoError(err, "resume your subscription"))
  }

  logger.info(
    `[billing] user ${owned.user.id} resumed ${owned.subscription.subscription_id}`,
  )
  return respondAfterMutation(owned, "Your subscription will continue to renew.")
}
