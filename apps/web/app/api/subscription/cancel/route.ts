import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { dodo } from "@/lib/dodo"
import { logger } from "@/lib/logger"
import {
  cancellationRejection,
  normalizeCancellationFeedback,
} from "@/lib/billing/subscription-action-rules"
import {
  describeDodoError,
  errorResponse,
  getOwnedSubscription,
  respondAfterMutation,
} from "@/lib/billing/subscription-actions"

const cancelBodySchema = z.object({
  feedback: z.string().max(64).optional(),
  comment: z.string().trim().max(1000).optional(),
})

/**
 * POST: cancel the member's subscription at the end of the current period.
 *
 * The subscription is never cancelled immediately: the member keeps access
 * until the date they already paid for, and can resume before then.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let rawBody: unknown = {}
  const text = await req.text()
  if (text.trim().length > 0) {
    try {
      rawBody = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
  }
  const parsed = cancelBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid cancellation details" }, { status: 400 })
  }

  const result = await getOwnedSubscription(userId)
  if (!result.ok) return errorResponse(result.error)
  const { owned } = result

  const rejection = cancellationRejection(
    owned.subscription.status,
    owned.subscription.cancel_at_next_billing_date,
  )
  if (rejection) {
    return NextResponse.json({ error: rejection.message }, { status: rejection.status })
  }

  const feedback = normalizeCancellationFeedback(parsed.data.feedback)
  const comment = parsed.data.comment || undefined

  try {
    await dodo.subscriptions.update(owned.subscription.subscription_id, {
      cancel_at_next_billing_date: true,
      cancel_reason: "cancelled_by_customer",
      ...(feedback ? { cancellation_feedback: feedback } : {}),
      ...(comment ? { cancellation_comment: comment } : {}),
    })
  } catch (err) {
    return errorResponse(describeDodoError(err, "cancel your subscription"))
  }

  logger.info(
    `[billing] user ${owned.user.id} scheduled cancellation of ${owned.subscription.subscription_id}${feedback ? ` (${feedback})` : ""}`,
  )
  return respondAfterMutation(
    owned,
    "Your subscription will end at the close of the current period.",
  )
}
