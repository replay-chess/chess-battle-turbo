import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getFeaturedPositions } from "@/lib/featured-positions";

export async function GET() {
  try {
    const positions = await getFeaturedPositions();

    return NextResponse.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    logger.error("GET /api/chess-positions/featured failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch featured positions" },
      { status: 500 },
    );
  }
}
