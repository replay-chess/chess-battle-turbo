import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const isActive = searchParams.get("isActive");
    const isVisible = searchParams.get("isVisible");

    // Build where clause based on query params
    const whereClause: { isActive?: boolean; isVisible?: boolean } = {};
    if (isActive !== null) {
      whereClause.isActive = isActive === "true";
    }
    if (isVisible !== null) {
      whereClause.isVisible = isVisible === "true";
    }

    const legends = await prisma.legend.findMany({
      where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
      orderBy: { name: "asc" },
      select: {
        id: true,
        referenceId: true,
        name: true,
        era: true,
        profilePhotoUrl: true,
        peakRating: true,
        nationality: true,
        shortDescription: true,
        playingStyle: true,
        birthYear: true,
        deathYear: true,
        achievements: true,
        famousGames: true,
        isActive: true,
        isVisible: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Convert BigInt to string and format for frontend
    const legendsFormatted = legends.map(legend => ({
      id: legend.referenceId, // Use referenceId as the ID for frontend
      visibleId: legend.id.toString(),
      referenceId: legend.referenceId,
      name: legend.name,
      era: legend.era,
      profilePhotoUrl: legend.profilePhotoUrl,
      peakRating: legend.peakRating,
      nationality: legend.nationality,
      shortDescription: legend.shortDescription,
      description: legend.shortDescription, // Keep for backwards compatibility with play page
      playingStyle: legend.playingStyle,
      birthYear: legend.birthYear,
      deathYear: legend.deathYear,
      achievements: legend.achievements,
      famousGames: legend.famousGames,
      isActive: legend.isActive,
      isVisible: legend.isVisible,
      createdAt: legend.createdAt,
      updatedAt: legend.updatedAt,
    }));

    return NextResponse.json(
      {
        success: true,
        data: { legends: legendsFormatted },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Error fetching legends:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch legends",
      },
      { status: 500 }
    );
  }
}
