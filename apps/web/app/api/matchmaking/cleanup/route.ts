import { NextRequest, NextResponse } from "next/server";
import { cleanupExpiredEntries } from "@/lib/services/matchmaking";
import { isInternalServiceRequest, resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

/**
 * Marks expired matchmaking queue entries. Restricted to internal service calls
 * (only honored on INTERNAL_ROUTE_PATHS — add this path there before pointing a
 * cron with the internal token at it) or a signed-in ADMIN.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isInternalServiceRequest(request)) {
      const user = await resolveUser(request);
      if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const expiredCount = await cleanupExpiredEntries();

    return NextResponse.json({
      success: true,
      data: {
        expiredCount,
        message: `Marked ${expiredCount} entries as expired`,
      },
    });
  } catch (error) {
    logger.error("Error cleaning up expired entries", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to cleanup expired entries",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
