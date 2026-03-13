import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { resolveUser, isInternalServiceRequest } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

const gameStateSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  whiteTime: z.number().int().min(0),
  blackTime: z.number().int().min(0),
  lastMoveAt: z.string().datetime().or(z.date()),
});

type GameStateRequest = z.infer<typeof gameStateSchema>;

export async function POST(request: NextRequest) {
  try {
    const isInternal = isInternalServiceRequest(request);

    // 1. Authenticate: Clerk session (browser) or internal service token (WebSocket server)
    if (!isInternal) {
      const authUser = await resolveUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const validatedData = gameStateSchema.parse(body);

    logger.info(`POST /api/chess/game-state - game ${validatedData.gameReferenceId}`);

    // 3. Find game
    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
    });

    if (!game) {
      return NextResponse.json(
        { success: false, error: "Game not found" },
        { status: 404 }
      );
    }

    // 4. Verify game status
    if (game.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { success: false, error: "Game is not in progress" },
        { status: 400 }
      );
    }

    // 5. Update game state (clocks and last move time)
    await prisma.game.update({
      where: { referenceId: validatedData.gameReferenceId },
      data: {
        creatorTimeRemaining: validatedData.whiteTime,
        opponentTimeRemaining: validatedData.blackTime,
        lastMoveAt: new Date(validatedData.lastMoveAt),
        updatedAt: new Date(),
      },
    });

    // 5. Return success
    return NextResponse.json(
      {
        success: true,
        message: "Game state updated successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    // Handle unexpected errors
    logger.error(`POST /api/chess/game-state failed: ${error instanceof Error ? error.message : "Unknown error"}`, error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to update game state",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

