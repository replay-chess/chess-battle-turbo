import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name || name.trim() === "") {
      return NextResponse.json(
        { error: "Name query parameter is required" },
        { status: 400 }
      );
    }

    // Convert search term to lowercase for comparison
    const searchTerm = name.toLowerCase().trim();

    logger.debug("Searching for legend: " + searchTerm);

    // Use Prisma's case-insensitive search
    // This uses PostgreSQL's ILIKE operator under the hood
    const legends = await prisma.legend.findMany({
      where: {
        name: {
          contains: searchTerm,
          mode: 'insensitive', // Case-insensitive search
        },
        isActive: true, // Only return active legends
      },
      orderBy: {
        name: 'asc',
      },
    });

    logger.debug(`Found ${legends.length} legends matching "${searchTerm}"`);

    // Convert BigInt IDs to strings for JSON serialization
    const legendsWithStringIds = legends.map(legend => ({
      ...legend,
      id: legend.id.toString(),
    }));

    return NextResponse.json({
      success: true,
      data: {
        query: name,
        count: legendsWithStringIds.length,
        legends: legendsWithStringIds,
      },
    });
  } catch (error) {
    logger.error("Error searching legends:", error);
    return NextResponse.json(
      {
        error: "Failed to search legends",
      },
      { status: 500 }
    );
  }
}
