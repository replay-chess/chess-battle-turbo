import { Webhooks } from "@dodopayments/nextjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { applySubscriptionSnapshot } from "@/lib/billing/entitlement"

/** The subset of a subscription event we persist; anything extra is ignored. */
const subscriptionSnapshotSchema = z.object({
  subscription_id: z.string().min(1),
  product_id: z.string().min(1),
  status: z.string().min(1),
  next_billing_date: z.union([z.string(), z.date()]),
  cancel_at_next_billing_date: z.boolean().default(false),
  created_at: z.union([z.string(), z.date()]).optional(),
  payment_frequency_interval: z.string().optional(),
  customer: z.object({
    customer_id: z.string().min(1),
    email: z.string(),
    name: z.string().optional(),
  }),
})

/**
 * Dodo Payments webhook.
 *
 * The adaptor verifies the Standard Webhooks signature before any handler
 * runs. Every subscription event carries the full, current subscription, so
 * each one is applied as a snapshot: the entitlement library decides whether
 * it is newer than what is stored, which makes redeliveries and out-of-order
 * events safe.
 */
export const POST = Webhooks({
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,

  onPayload: async (payload) => {
    if (payload.type.startsWith("subscription.")) {
      const parsed = subscriptionSnapshotSchema.safeParse(payload.data)
      if (!parsed.success) {
        logger.warn(
          `[Dodo] ${payload.type} payload missing subscription fields: ${parsed.error.message}`,
        )
        return
      }
      const eventTime =
        payload.timestamp instanceof Date
          ? payload.timestamp
          : new Date(payload.timestamp)
      await applySubscriptionSnapshot(parsed.data, {
        source: "webhook",
        eventTime: Number.isNaN(eventTime.getTime()) ? null : eventTime,
      })
      return
    }

    if (payload.type === "payment.succeeded") {
      const customer = (payload.data as { customer?: { email?: string; customer_id: string } })
        .customer
      if (customer?.email) {
        // Link the Dodo customer as early as possible so the subscription
        // event that follows can find the user by customer ID.
        await prisma.user.updateMany({
          where: { email: customer.email, dodoCustomerId: null },
          data: { dodoCustomerId: customer.customer_id },
        })
      }
      return
    }

    logger.debug(`[Dodo] Unhandled webhook ${payload.type}`)
  },
})
