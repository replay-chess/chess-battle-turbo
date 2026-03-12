import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const positions = await prisma.chessPosition.findMany({
      where: {
        featured: true,
        isActive: true,
      },
      take: 6,
      orderBy: { createdAt: "desc" },
      select: {
        referenceId: true,
        fen: true,
        sideToMove: true,
        whitePlayerName: true,
        blackPlayerName: true,
        tournamentName: true,
        positionType: true,
        positionContext: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    logger.error("GET /api/chess-positions/featured failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch featured positions" },
      { status: 500 }
    );
  }
}
