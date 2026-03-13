import { NextRequest, NextResponse } from "next/server";
import { cancelMatchRequest } from "@/lib/services/matchmaking";
import { resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

/**
 * Beacon-compatible cancel endpoint
 * Accepts application/x-www-form-urlencoded for sendBeacon() compatibility
 * Returns minimal response and gracefully handles already-processed entries
 *
 * Auth: Uses Clerk session cookie (sendBeacon includes cookies for same-origin).
 * The user from the session is used instead of trusting userReferenceId from the body.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";

    let queueReferenceId: string | null = null;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.text();
      const params = new URLSearchParams(formData);
      queueReferenceId = params.get("queueReferenceId");
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      queueReferenceId = body.queueReferenceId;
    } else {
      const formData = await request.text();
      const params = new URLSearchParams(formData);
      queueReferenceId = params.get("queueReferenceId");
    }

    if (!queueReferenceId) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    await cancelMatchRequest(queueReferenceId, user.referenceId);

    // Minimal response for beacon
    return NextResponse.json({ success: true });
  } catch (error) {
    // Log but don't fail - beacons are fire-and-forget
    logger.error("Beacon cancel error", error);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
