import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { dodo } from "@/lib/dodo"
import { resolvePlanFromProductId } from "@/lib/billing/plans"
import { getProductCatalog } from "@/lib/billing/products"

export async function GET() {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findFirst({
    where: { googleId: clerkUserId },
    select: { id: true, email: true, dodoCustomerId: true },
  })

  let customerId = user?.dodoCustomerId

  // Self-heal: if dodoCustomerId is missing, look up by email in Dodo
  if (!customerId && user?.email) {
    try {
      const customers = await dodo.customers.list({ email: user.email })
      const items = []
      for await (const c of customers) {
        items.push(c)
      }
      if (items.length > 0) {
        customerId = items[0]!.customer_id
        await prisma.user.update({
          where: { id: user.id },
          data: { dodoCustomerId: customerId },
        })
      }
    } catch {
      // Dodo lookup failed — fall through to no plan
    }
  }

  if (!customerId) {
    return NextResponse.json({ plan: null })
  }

  try {
    const subscriptions = await dodo.subscriptions.list({
      customer_id: customerId,
      status: "active",
    })

    const subItems = []
    for await (const sub of subscriptions) {
      subItems.push(sub)
    }

    if (subItems.length === 0) {
      return NextResponse.json({
        plan: null,
        customerId,
      })
    }

    // Prefer a subscription on a product we know how to describe. Any other
    // active subscription still counts as the Player plan so nobody who paid
    // is locked out because of a product ID mismatch.
    const catalog = getProductCatalog()
    const activeSub =
      subItems.find((sub) => resolvePlanFromProductId(sub.product_id, catalog)) ??
      subItems[0]!
    const resolved = resolvePlanFromProductId(activeSub.product_id, catalog)
    if (!resolved && process.env.NODE_ENV === "development") {
      console.warn(
        "[subscription] Active subscription on unknown product:",
        activeSub.product_id,
      )
    }

    return NextResponse.json({
      plan: "player",
      customerId,
      subscription: {
        id: activeSub.subscription_id,
        status: activeSub.status,
        productId: activeSub.product_id,
        nextBillingDate: activeSub.next_billing_date,
        planKey: resolved?.planKey ?? null,
        interval:
          resolved?.interval ??
          (activeSub.payment_frequency_interval === "Year" ? "year" : "month"),
        priceCents: resolved?.priceCents ?? null,
      },
    })
  } catch {
    return NextResponse.json({ plan: null, customerId })
  }
}
