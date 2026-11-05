import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/require-admin";

const MAX_LIMIT = 50;

/** Parses an integer query value and clamps it to [min, max]; missing or invalid → fallback. */
function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Columns the admin list needs (plan A11). `explanation` and `explanationAudioUrl` (large,
 * unused by the list) are left out. The player, game, context and source metadata stay:
 * the admin edit form (`app/admin/chess-positions/page.tsx`) loads them from this list and
 * sends them back on save, so leaving them out would erase them.
 */
const POSITION_LIST_SELECT = {
  id: true,
  referenceId: true,
  fen: true,
  sideToMove: true,
  pgn: true,
  moveNumber: true,
  whitePlayerName: true,
  blackPlayerName: true,
  whitePlayerMetadata: true,
  blackPlayerMetadata: true,
  whitePlayerId: true,
  blackPlayerId: true,
  tournamentName: true,
  eventDate: true,
  gameMetadata: true,
  positionType: true,
  positionContext: true,
  sourceType: true,
  sourceMetadata: true,
  featured: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get("isActive");
    const featured = searchParams.get("featured");
    const page = clampInt(searchParams.get("page"), 1, 1, 100_000);
    const limit = clampInt(searchParams.get("limit"), 50, 1, MAX_LIMIT);

    // Build where clause
    const where: {
      isActive?: boolean;
      featured?: boolean;
    } = {};

    if (isActive !== null) {
      where.isActive = isActive === "true";
    }

    if (featured !== null) {
      where.featured = featured === "true";
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch positions with related legends
    const [positions, total] = await Promise.all([
      prisma.chessPosition.findMany({
        where,
        select: {
          ...POSITION_LIST_SELECT,
          whiteLegend: {
            select: {
              id: true,
              referenceId: true,
              name: true,
              era: true,
              profilePhotoUrl: true,
            },
          },
          blackLegend: {
            select: {
              id: true,
              referenceId: true,
              name: true,
              era: true,
              profilePhotoUrl: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.chessPosition.count({ where }),
    ]);

    // Convert BigInt IDs to strings for JSON serialization
    const positionsWithStringIds = positions.map((position) => ({
      ...position,
      id: position.id.toString(),
      whitePlayerId: position.whitePlayerId?.toString() || null,
      blackPlayerId: position.blackPlayerId?.toString() || null,
      whiteLegend: position.whiteLegend
        ? {
            ...position.whiteLegend,
            id: position.whiteLegend.id.toString(),
          }
        : null,
      blackLegend: position.blackLegend
        ? {
            ...position.blackLegend,
            id: position.blackLegend.id.toString(),
          }
        : null,
    }));

    return NextResponse.json({
      success: true,
      data: {
        positions: positionsWithStringIds,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching chess positions:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch chess positions",
      },
      { status: 500 }
    );
  }
}
