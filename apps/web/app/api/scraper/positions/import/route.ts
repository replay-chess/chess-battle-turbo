import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@repo/db";
import { validateScraperApiKey } from "@/lib/auth/api-key";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logger } from "@/lib/logger";

// Schema for player/legend data embedded in the request
const playerSchema = z.object({
  name: z.string().min(1, "Player name is required"),
  era: z.string().optional(),
  shortDescription: z.string().max(500).optional(),
  profilePhotoUrl: z.string().url("Must be a valid URL").optional().nullable(),
  peakRating: z.number().int().positive().optional().nullable(),
  nationality: z.string().optional().nullable(),
  playingStyle: z.string().optional().nullable(),
  birthYear: z.number().int().min(1000).max(9999).optional().nullable(),
  deathYear: z.number().int().min(1000).max(9999).optional().nullable(),
});

// Main schema for position import
const importPositionSchema = z.object({
  // Required fields
  fen: z.string().min(1, "FEN is required"),
  sideToMove: z.enum(["white", "black"], {
    message: "Side to move must be 'white' or 'black'",
  }),
  sourceType: z.string().min(1, "Source type is required"),

  // Optional position data
  pgn: z.string().optional().nullable(),
  moveNumber: z.number().int().positive().optional().nullable(),
  tournamentName: z.string().optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  gameMetadata: z.any().optional().nullable(),
  positionType: z.string().optional().nullable(),
  positionContext: z.any().optional().nullable(),
  sourceMetadata: z
    .object({
      url: z.string().url().optional(),
      videoId: z.string().optional(),
      gameId: z.string().optional(),
      importedAt: z.string().datetime().optional(),
    })
    .optional()
    .nullable(),

  // Optional player data (finds existing legend by name, or creates new if not found)
  whitePlayer: playerSchema.optional().nullable(),
  blackPlayer: playerSchema.optional().nullable(),

  // System flags
  featured: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

type PlayerData = z.infer<typeof playerSchema>;

/**
 * Finds an existing legend by name, or creates a new one if not found.
 * IMPORTANT: Does NOT update existing legends - returns them unchanged.
 */
async function findOrCreateLegend(
  tx: Prisma.TransactionClient,
  playerData: PlayerData
): Promise<{ id: bigint; referenceId: string; name: string; created: boolean }> {
  // Look for existing legend by name - if found, return as-is (no updates)
  const existing = await tx.legend.findUnique({
    where: { name: playerData.name },
    select: { id: true, referenceId: true, name: true },
  });

  if (existing) {
    return { ...existing, created: false };
  }

  // Legend doesn't exist - create new one
  const newLegend = await tx.legend.create({
    data: {
      name: playerData.name,
      era: playerData.era || "Unknown",
      shortDescription:
        playerData.shortDescription || `Chess player ${playerData.name}`,
      profilePhotoUrl: playerData.profilePhotoUrl || null,
      peakRating: playerData.peakRating || null,
      nationality: playerData.nationality || null,
      playingStyle: playerData.playingStyle || null,
      birthYear: playerData.birthYear || null,
      deathYear: playerData.deathYear || null,
      isActive: true,
      isVisible: false, // New legends hidden until manually reviewed
    },
    select: { id: true, referenceId: true, name: true },
  });

  return { ...newLegend, created: true };
}

export async function POST(request: NextRequest) {
  // Step 1: Validate API key or admin session
  const authResult = validateScraperApiKey(request);
  if (!authResult.valid) {
    // Fall back to admin session check
    const { error } = await requireAdmin();
    if (error) return error;
  }

  try {
    const body = await request.json();
    const validatedData = importPositionSchema.parse(body);

    // Step 2: Use transaction for atomicity
    const result = await prisma.$transaction(async (tx) => {
      let whitePlayerId: bigint | null = null;
      let blackPlayerId: bigint | null = null;
      let whiteLegendInfo: {
        id: string;
        referenceId: string;
        name: string;
        created: boolean;
      } | null = null;
      let blackLegendInfo: {
        id: string;
        referenceId: string;
        name: string;
        created: boolean;
      } | null = null;

      // Step 3: Find or create white player legend if provided
      if (validatedData.whitePlayer) {
        const legend = await findOrCreateLegend(tx, validatedData.whitePlayer);
        whitePlayerId = legend.id;
        whiteLegendInfo = {
          id: legend.id.toString(),
          referenceId: legend.referenceId,
          name: legend.name,
          created: legend.created,
        };
      }

      // Step 4: Find or create black player legend if provided
      if (validatedData.blackPlayer) {
        const legend = await findOrCreateLegend(tx, validatedData.blackPlayer);
        blackPlayerId = legend.id;
        blackLegendInfo = {
          id: legend.id.toString(),
          referenceId: legend.referenceId,
          name: legend.name,
          created: legend.created,
        };
      }

      // Step 5: Create the chess position
      const position = await tx.chessPosition.create({
        data: {
          fen: validatedData.fen,
          sideToMove: validatedData.sideToMove,
          pgn: validatedData.pgn || null,
          moveNumber: validatedData.moveNumber || null,

          whitePlayerName: validatedData.whitePlayer?.name || null,
          blackPlayerName: validatedData.blackPlayer?.name || null,
          whitePlayerMetadata: Prisma.JsonNull,
          blackPlayerMetadata: Prisma.JsonNull,
          whitePlayerId,
          blackPlayerId,

          tournamentName: validatedData.tournamentName || null,
          eventDate: validatedData.eventDate
            ? new Date(validatedData.eventDate)
            : null,
          gameMetadata: validatedData.gameMetadata
            ? validatedData.gameMetadata
            : Prisma.JsonNull,

          positionType: validatedData.positionType || null,
          positionContext: validatedData.positionContext
            ? validatedData.positionContext
            : Prisma.JsonNull,

          sourceType: validatedData.sourceType,
          sourceMetadata: validatedData.sourceMetadata
            ? validatedData.sourceMetadata
            : Prisma.JsonNull,

          featured: validatedData.featured,
          isActive: validatedData.isActive,
          timesPlayed: 0,
        },
      });

      return {
        position,
        whiteLegendInfo,
        blackLegendInfo,
      };
    }, {
      maxWait: 10000,  // Max 10 seconds to acquire connection
      timeout: 15000,  // Max 15 seconds to complete transaction
    });

    return NextResponse.json(
      {
        success: true,
        message: "Position imported successfully",
        data: {
          position: {
            id: result.position.id.toString(),
            referenceId: result.position.referenceId,
            fen: result.position.fen,
            sideToMove: result.position.sideToMove,
            sourceType: result.position.sourceType,
            createdAt: result.position.createdAt,
          },
          legends: {
            white: result.whiteLegendInfo,
            black: result.blackLegendInfo,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    // Handle Zod validation errors
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

      logger.error("Prisma error: " + error.code + " " + error.message, error);
      return NextResponse.json(
        {
          error: "Database error",
        },
        { status: 500 }
      );
    }

    // Handle unexpected errors
    logger.error("Error importing position:", error);
    return NextResponse.json(
      {
        error: "Failed to import position",
      },
      { status: 500 }
    );
  }
}
