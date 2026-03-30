import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createRateLimiter } from "@/lib/rate-limit";

const rateLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }

    if (rateLimiter.isLimited(userId)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    const openings = await prisma.opening.findMany({
      where: { isActive: true },
      select: {
        referenceId: true,
        eco: true,
        name: true,
      },
      orderBy: [{ eco: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({
      success: true,
      data: {
        openings: openings.map((o) => ({
          id: o.referenceId,
          eco: o.eco,
          name: o.name,
        })),
      },
    });
  } catch (error) {
    logger.error("Error fetching openings", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch openings" },
      { status: 500 }
    );
  }
}
