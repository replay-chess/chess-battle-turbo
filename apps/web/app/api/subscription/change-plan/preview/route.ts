import { NextRequest, NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { z } from "zod"
import { dodo } from "@/lib/dodo"
import { PLAN_KEYS, resolvePlanFromProductId } from "@/lib/billing/plans"
import { getProductCatalog } from "@/lib/billing/products"
import {
  decidePlanChange,
  isPlanChangeRejection,
  mapPlanChangePreview,
} from "@/lib/billing/subscription-action-rules"
import {
  buildChangePlanParams,
  describeDodoError,
  errorResponse,
  getOwnedSubscription,
} from "@/lib/billing/subscription-actions"

const previewBodySchema = z.object({
  plan: z.enum(PLAN_KEYS),
})

/**
 * POST: what a plan change would cost right now, without applying it. The
 * upgrade modal shows this before the member confirms.
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
  const parsed = previewBodySchema.safeParse(rawBody)
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

  try {
    const raw = await dodo.subscriptions.previewChangePlan(
      owned.subscription.subscription_id,
      buildChangePlanParams(decision),
    )
    const catalog = getProductCatalog()
    const preview = mapPlanChangePreview(raw, (productId) => {
      const resolved = resolvePlanFromProductId(productId, catalog)
      return {
        planKey: resolved?.planKey ?? null,
        interval: resolved?.interval ?? null,
        priceCents: resolved?.priceCents ?? null,
      }
    })
    return NextResponse.json({
      ...preview,
      change: { target: decision.target, kind: decision.kind, effectiveAt: decision.effectiveAt },
    })
  } catch (err) {
    return errorResponse(describeDodoError(err, "preview the plan change"))
  }
}
