import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@repo/db";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/require-admin";

// Schema for updating chess position (all fields optional for partial updates)
const updateChessPositionSchema = z.object({
  fen: z.string().min(1, "FEN is required").optional(),
  sideToMove: z.enum(["white", "black"], {
    message: "Side to move must be 'white' or 'black'",
  }).optional(),

  pgn: z.string().optional().nullable(),
  moveNumber: z.number().int().positive().optional().nullable(),

  whitePlayerName: z.string().optional().nullable(),
  blackPlayerName: z.string().optional().nullable(),
  whitePlayerMetadata: z.any().optional().nullable(),
  blackPlayerMetadata: z.any().optional().nullable(),
  whitePlayerId: z.string().optional().nullable(),
  blackPlayerId: z.string().optional().nullable(),

  tournamentName: z.string().optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  gameMetadata: z.any().optional().nullable(),

  positionType: z.string().optional().nullable(),
  positionContext: z.any().optional().nullable(),

  sourceType: z.string().optional(),
  sourceMetadata: z.any().optional().nullable(),

  featured: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Helper to find position by referenceId or BigInt id
async function findPosition(id: string) {
  // First try referenceId (CUID)
  let position = await prisma.chessPosition.findUnique({
    where: { referenceId: id },
    include: {
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
  });

  // If not found, try BigInt id
  if (!position) {
    try {
      const bigIntId = BigInt(id);
      position = await prisma.chessPosition.findUnique({
        where: { id: bigIntId },
        include: {
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
      });
    } catch {
      // Invalid BigInt format, position not found
    }
  }

  return position;
}

const LEGEND_SUMMARY_SELECT = {
  id: true,
  referenceId: true,
  name: true,
  era: true,
  profilePhotoUrl: true,
} as const;

/**
 * Columns GET returns (plan A11): an explicit select without `explanation` (and its audio URL),
 * `sourceMetadata` or the white/black player metadata. Unlike the list route, nothing reads this
 * endpoint back into the admin edit form, so those fields have no consumer here.
 */
const POSITION_DETAIL_SELECT = {
  id: true,
  referenceId: true,
  fen: true,
  sideToMove: true,
  pgn: true,
  moveNumber: true,
  whitePlayerName: true,
  blackPlayerName: true,
  whitePlayerId: true,
  blackPlayerId: true,
  tournamentName: true,
  eventDate: true,
  gameMetadata: true,
  positionType: true,
  positionContext: true,
  sourceType: true,
  timesPlayed: true,
  popularityScore: true,
  featured: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  whiteLegend: { select: LEGEND_SUMMARY_SELECT },
  blackLegend: { select: LEGEND_SUMMARY_SELECT },
} satisfies Prisma.ChessPositionSelect;

// GET's lookup: referenceId (CUID) first, then the BigInt id, with the A11 projection.
async function findPositionDetail(id: string) {
  const byRef = await prisma.chessPosition.findUnique({
    where: { referenceId: id },
    select: POSITION_DETAIL_SELECT,
  });
  if (byRef) return byRef;
  let bigIntId: bigint;
  try {
    bigIntId = BigInt(id);
  } catch {
    return null; // not a CUID we know and not a numeric id
  }
  return prisma.chessPosition.findUnique({ where: { id: bigIntId }, select: POSITION_DETAIL_SELECT });
}

// Helper to resolve legend referenceId to BigInt id
async function resolveLegendId(
  referenceId: string | null | undefined
): Promise<bigint | null> {
  if (!referenceId) return null;

  const legend = await prisma.legend.findUnique({
    where: { referenceId },
    select: { id: true },
  });

  return legend?.id || null;
}

// GET - Fetch single position
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    const position = await findPositionDetail(id);

    if (!position) {
      return NextResponse.json(
        { error: "Chess position not found" },
        { status: 404 }
      );
    }

    // Convert BigInt IDs to strings
    const positionWithStringIds = {
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
    };

    return NextResponse.json({
      success: true,
      data: { position: positionWithStringIds },
    });
  } catch (error) {
    logger.error("Error fetching chess position:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch chess position",
      },
      { status: 500 }
    );
  }
}

// PUT - Update position
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    const body = await request.json();

    // Find existing position
    const existingPosition = await findPosition(id);
    if (!existingPosition) {
      return NextResponse.json(
        { error: "Chess position not found" },
        { status: 404 }
      );
    }

    // Validate update data
    const validatedData = updateChessPositionSchema.parse(body);

    // Resolve legend IDs if provided
    let whitePlayerId: bigint | null | undefined;
    let blackPlayerId: bigint | null | undefined;

    if (validatedData.whitePlayerId !== undefined) {
      whitePlayerId = await resolveLegendId(validatedData.whitePlayerId);
    }

    if (validatedData.blackPlayerId !== undefined) {
      blackPlayerId = await resolveLegendId(validatedData.blackPlayerId);
    }

    // Build update data
    const updateData: Prisma.ChessPositionUpdateInput = {};

    if (validatedData.fen !== undefined) updateData.fen = validatedData.fen;
    if (validatedData.sideToMove !== undefined)
      updateData.sideToMove = validatedData.sideToMove;
    if (validatedData.pgn !== undefined)
      updateData.pgn = validatedData.pgn || null;
    if (validatedData.moveNumber !== undefined)
      updateData.moveNumber = validatedData.moveNumber;

    if (validatedData.whitePlayerName !== undefined)
      updateData.whitePlayerName = validatedData.whitePlayerName || null;
    if (validatedData.blackPlayerName !== undefined)
      updateData.blackPlayerName = validatedData.blackPlayerName || null;

    if (validatedData.whitePlayerMetadata !== undefined) {
      updateData.whitePlayerMetadata = validatedData.whitePlayerMetadata
        ? (validatedData.whitePlayerMetadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    if (validatedData.blackPlayerMetadata !== undefined) {
      updateData.blackPlayerMetadata = validatedData.blackPlayerMetadata
        ? (validatedData.blackPlayerMetadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    if (whitePlayerId !== undefined) {
      updateData.whiteLegend = whitePlayerId
        ? { connect: { id: whitePlayerId } }
        : { disconnect: true };
    }
    if (blackPlayerId !== undefined) {
      updateData.blackLegend = blackPlayerId
        ? { connect: { id: blackPlayerId } }
        : { disconnect: true };
    }

    if (validatedData.tournamentName !== undefined)
      updateData.tournamentName = validatedData.tournamentName || null;
    if (validatedData.eventDate !== undefined) {
      updateData.eventDate = validatedData.eventDate
        ? new Date(validatedData.eventDate)
        : null;
    }
    if (validatedData.gameMetadata !== undefined) {
      updateData.gameMetadata = validatedData.gameMetadata
        ? (validatedData.gameMetadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    if (validatedData.positionType !== undefined)
      updateData.positionType = validatedData.positionType || null;
    if (validatedData.positionContext !== undefined) {
      updateData.positionContext = validatedData.positionContext
        ? (validatedData.positionContext as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    if (validatedData.sourceType !== undefined)
      updateData.sourceType = validatedData.sourceType;
    if (validatedData.sourceMetadata !== undefined) {
      updateData.sourceMetadata = validatedData.sourceMetadata
        ? (validatedData.sourceMetadata as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }

    if (validatedData.featured !== undefined)
      updateData.featured = validatedData.featured;
    if (validatedData.isActive !== undefined)
      updateData.isActive = validatedData.isActive;

    // Update the position
    const updatedPosition = await prisma.chessPosition.update({
      where: { id: existingPosition.id },
      data: updateData,
      include: {
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
    });

    // Convert BigInt IDs to strings
    const positionWithStringIds = {
      ...updatedPosition,
      id: updatedPosition.id.toString(),
      whitePlayerId: updatedPosition.whitePlayerId?.toString() || null,
      blackPlayerId: updatedPosition.blackPlayerId?.toString() || null,
      whiteLegend: updatedPosition.whiteLegend
        ? {
            ...updatedPosition.whiteLegend,
            id: updatedPosition.whiteLegend.id.toString(),
          }
        : null,
      blackLegend: updatedPosition.blackLegend
        ? {
            ...updatedPosition.blackLegend,
            id: updatedPosition.blackLegend.id.toString(),
          }
        : null,
    };

    return NextResponse.json({
      success: true,
      message: "Chess position updated successfully",
      data: { position: positionWithStringIds },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    logger.error("Error updating chess position:", error);
    return NextResponse.json(
      {
        error: "Failed to update chess position",
      },
      { status: 500 }
    );
  }
}

// DELETE - Delete position
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const { id } = await params;
    const position = await findPosition(id);

    if (!position) {
      return NextResponse.json(
        { error: "Chess position not found" },
        { status: 404 }
      );
    }

    // Delete the position
    await prisma.chessPosition.delete({
      where: { id: position.id },
    });

    return NextResponse.json({
      success: true,
      message: "Chess position deleted successfully",
      data: {
        deletedPosition: {
          id: position.id.toString(),
          referenceId: position.referenceId,
          fen: position.fen,
        },
      },
    });
  } catch (error) {
    logger.error("Error deleting chess position:", error);
    return NextResponse.json(
      {
        error: "Failed to delete chess position",
      },
      { status: 500 }
    );
  }
}
