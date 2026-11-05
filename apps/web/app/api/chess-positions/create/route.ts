import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth/require-admin";

const createChessPositionSchema = z.object({
  // Required fields
  fen: z.string().min(1, "FEN is required"),
  sideToMove: z.enum(["white", "black"], {
    message: "Side to move must be 'white' or 'black'",
  }),

  // Optional core data
  pgn: z.string().optional().nullable(),
  moveNumber: z.number().int().positive().optional().nullable(),

  // Player info
  whitePlayerName: z.string().optional().nullable(),
  blackPlayerName: z.string().optional().nullable(),
  whitePlayerMetadata: z.any().optional().nullable(),
  blackPlayerMetadata: z.any().optional().nullable(),
  whitePlayerId: z.number().int().positive().optional().nullable(),
  blackPlayerId: z.number().int().positive().optional().nullable(),

  // Game metadata
  tournamentName: z.string().optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  gameMetadata: z.any().optional().nullable(),

  // Position info
  positionType: z.string().optional().nullable(),
  positionContext: z.any().optional().nullable(),

  // Source
  sourceType: z.string().default("manual"),
  sourceMetadata: z.any().optional().nullable(),

  // System fields
  featured: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.error) return admin.error;

  try {
    const body = await request.json();
    logger.debug("Received chess position data: " + JSON.stringify(body));

    const validatedData = createChessPositionSchema.parse(body);
    logger.debug("Validated data: " + JSON.stringify(validatedData));

    // Create the chess position
    const position = await prisma.chessPosition.create({
      data: {
        fen: validatedData.fen,
        sideToMove: validatedData.sideToMove,
        pgn: validatedData.pgn || null,
        moveNumber: validatedData.moveNumber || null,

        whitePlayerName: validatedData.whitePlayerName || null,
        blackPlayerName: validatedData.blackPlayerName || null,
        whitePlayerMetadata: validatedData.whitePlayerMetadata ? validatedData.whitePlayerMetadata : Prisma.JsonNull,
        blackPlayerMetadata: validatedData.blackPlayerMetadata ? validatedData.blackPlayerMetadata : Prisma.JsonNull,
        whitePlayerId: validatedData.whitePlayerId ? BigInt(validatedData.whitePlayerId) : null,
        blackPlayerId: validatedData.blackPlayerId ? BigInt(validatedData.blackPlayerId) : null,

        tournamentName: validatedData.tournamentName || null,
        eventDate: validatedData.eventDate ? new Date(validatedData.eventDate) : null,
        gameMetadata: validatedData.gameMetadata ? validatedData.gameMetadata : Prisma.JsonNull,

        positionType: validatedData.positionType || null,
        positionContext: validatedData.positionContext ? validatedData.positionContext : Prisma.JsonNull,

        sourceType: validatedData.sourceType,
        sourceMetadata: validatedData.sourceMetadata ? validatedData.sourceMetadata : Prisma.JsonNull,

        featured: validatedData.featured,
        isActive: validatedData.isActive,
        timesPlayed: 0,
      },
    });

    logger.info("Chess position created successfully: " + position.id);

    return NextResponse.json(
      {
        success: true,
        message: "Chess position created successfully",
        data: {
          position: {
            id: position.id.toString(),
            referenceId: position.referenceId,
            fen: position.fen,
            sideToMove: position.sideToMove,
            createdAt: position.createdAt,
          },
        },
      },
      { status: 201 }
    );
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

    // Handle Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002: Unique constraint violation (duplicate FEN)
      if (error.code === "P2002") {
        return NextResponse.json(
          {
            error: "Position already exists",
            details: "A position with this FEN already exists in the database",
          },
          { status: 409 }
        );
      }
    }

    logger.error("Error creating chess position:", error);
    return NextResponse.json(
      {
        error: "Failed to create chess position",
      },
      { status: 500 }
    );
  }
}
