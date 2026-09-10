import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { dodo } from "@/lib/dodo"
import { describeDodoError, errorResponse } from "@/lib/billing/subscription-actions"

/**
 * Opens the Dodo customer portal for the signed-in member.
 *
 * The customer is always resolved from the caller's own user row; nothing in
 * the query string is read, so a portal session can never be opened for
 * somebody else's customer ID.
 */
export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { googleId: userId },
    select: { dodoCustomerId: true },
  })
  if (!user?.dodoCustomerId) {
    // Nothing to manage yet: send them to the plan picker instead of failing.
    return NextResponse.redirect(new URL("/pricing", req.url))
  }

  try {
    const session = await dodo.customers.customerPortal.create(user.dodoCustomerId, {
      send_email: false,
    })
    return NextResponse.redirect(session.link)
  } catch (err) {
    return errorResponse(describeDodoError(err, "open the billing portal"))
  }
}
