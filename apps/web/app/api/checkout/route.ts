import { NextRequest, NextResponse } from "next/server"
import { auth, currentUser } from "@clerk/nextjs/server"
import { z } from "zod"
import { dodo } from "@/lib/dodo"
import { prisma } from "@/lib/prisma"
import { BASE_URL } from "@/lib/seo"
import { PLAN_KEYS } from "@/lib/billing/plans"
import {
  BillingNotConfiguredError,
  getProductIdForPlan,
} from "@/lib/billing/products"

/**
 * Paths a checkout may return to. Anything else falls back to /pricing so the
 * return URL can never be turned into an open redirect.
 */
const RETURN_PATH_PREFIXES = [
  "/pricing",
  "/onboarding",
  "/play",
  "/queue",
  "/challenge",
  "/join",
  "/join-tournament",
  "/tournament",
  "/legends",
  "/openings",
  "/position",
  "/profile",
  "/analysis",
]

const checkoutBodySchema = z.object({
  plan: z.enum(PLAN_KEYS),
  returnPath: z.string().max(512).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
})

/** Origin the user should land on after paying. */
function appOrigin(): string {
  const configured = process.env.DODO_PAYMENTS_RETURN_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // fall through to the canonical site
    }
  }
  return BASE_URL
}

export function buildReturnUrl(returnPath: string | undefined): string {
  const safePath =
    returnPath &&
    returnPath.startsWith("/") &&
    !returnPath.startsWith("//") &&
    RETURN_PATH_PREFIXES.some((prefix) => returnPath.startsWith(prefix))
      ? returnPath
      : "/pricing"
  const url = new URL(safePath, appOrigin())
  url.searchParams.set("checkout", "success")
  return url.toString()
}

/**
 * Creates a Dodo Payments checkout session for the Player plan.
 *
 * The client only chooses a plan key ("monthly" | "yearly"). The product ID,
 * customer email, and name all come from the server so a caller cannot start
 * a checkout for an arbitrary product or on behalf of another email address.
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

  const parsed = checkoutBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a monthly or yearly plan" },
      { status: 400 },
    )
  }
  const { plan, returnPath, theme } = parsed.data

  const clerkUser = await currentUser()
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress
  if (!email) {
    return NextResponse.json(
      { error: "Your account has no email address" },
      { status: 400 },
    )
  }
  const name =
    clerkUser?.fullName ??
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ??
    undefined

  let productId: string
  try {
    productId = getProductIdForPlan(plan)
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      console.error("[checkout]", err.message)
      return NextResponse.json(
        { error: "This plan is not available right now" },
        { status: 503 },
      )
    }
    throw err
  }

  // Avoid creating a second subscription for someone who is already active.
  const dbUser = await prisma.user.findFirst({
    where: { googleId: userId },
    select: { dodoCustomerId: true },
  })
  if (dbUser?.dodoCustomerId) {
    try {
      const active = await dodo.subscriptions.list({
        customer_id: dbUser.dodoCustomerId,
        status: "active",
      })
      for await (const _subscription of active) {
        return NextResponse.json(
          {
            error: "You already have an active subscription",
            code: "already_subscribed",
            customerId: dbUser.dodoCustomerId,
          },
          { status: 409 },
        )
      }
    } catch (err) {
      // A lookup failure should not block a legitimate checkout.
      if (process.env.NODE_ENV === "development") {
        console.warn("[checkout] Could not verify existing subscriptions:", err)
      }
    }
  }

  try {
    const session = await dodo.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email, name: name || undefined },
      metadata: { clerkUserId: userId, plan },
      return_url: buildReturnUrl(returnPath),
      customization: { theme: theme ?? "system", show_order_details: true },
      feature_flags: {
        // Land the user straight back in the app instead of on Dodo's own
        // success page; the return page confirms activation itself.
        redirect_immediately: true,
        allow_discount_code: true,
      },
    })

    return NextResponse.json({
      checkoutUrl: session.checkout_url,
      sessionId: session.session_id,
    })
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[checkout] Dodo API error:", err)
    }
    const message =
      err instanceof Error ? err.message : "Failed to create checkout session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
