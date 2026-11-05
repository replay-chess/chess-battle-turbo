// GET /api/subscription (plan §7.4 A6; legacy handler, not route() yet; deprecated). The Phase 0
// `SubscriptionResponse` body, unchanged, for clients that still read it until P10.
//
// DB-only since P1: one statement (the viewer read), no Dodo call and no write. The Dodo self-heal and refresh moved
// to POST /api/billing/refresh (A19), which useUserStore's fetchSubscription calls (1B·F4d). Errors use the
// `{ error }` envelope.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { NO_STORE } from "@/lib/api/cache";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/api/request-id";
import { errorResponse } from "@/lib/api/respond";
import { isPaywallEnabled } from "@/lib/auth/membership";
import { queryViewerRecord } from "@/lib/auth/viewer";
import { toLegacySubscription } from "@/lib/auth/viewer-dto";
import { summarizeEntitlement } from "@/lib/billing/entitlement-rules";
import { getProductCatalog } from "@/lib/billing/products";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export type { SubscriptionResponse } from "@/lib/auth/viewer-dto";

export const dynamic = "force-dynamic";

/** Returns the signed-in user's stored entitlement. */
export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request.headers);
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return errorResponse({ code: "unauthorized", requestId });

    const user = await queryViewerRecord(prisma, clerkUserId);
    if (!user || !user.isActive) return errorResponse({ code: "not_found", message: "User not found.", requestId });

    const summary = summarizeEntitlement(user, getProductCatalog());
    const body = toLegacySubscription(summary, {
      customerId: user.dodoCustomerId,
      productId: user.subscriptionProductId,
      paywall: isPaywallEnabled(),
    });
    return NextResponse.json(body, { headers: { "Cache-Control": NO_STORE, [REQUEST_ID_HEADER]: requestId } });
  } catch (error) {
    logger.error("GET /api/subscription failed", error);
    return errorResponse({ code: "internal", requestId });
  }
}
