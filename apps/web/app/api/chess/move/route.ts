import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/prisma";
import { resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/sentry/logger";
import { trackUserAction } from "@/lib/metrics";

const moveSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  from: z.string().min(2).max(2),
  to: z.string().min(2).max(2),
  promotion: z.string().optional(),
  fen: z.string().min(1, "FEN is required"),
  moveHistory: z.array(z.any()),
  whiteTime: z.number().int().min(0),
  blackTime: z.number().int().min(0),
});

type MoveRequest = z.infer<typeof moveSchema>;

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user via Clerk session
    const authUser = await resolveUser(request);
    if (!authUser) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const validatedData = moveSchema.parse(body);

    Sentry.setTag("game.referenceId", validatedData.gameReferenceId);
    trackUserAction("make_move");

    // 3. Find game with user relations to get reference IDs
    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
      include: {
        creator: true,
        opponent: true,
      },
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

    // 5. Verify authenticated user is part of the game
    const isCreator = game.creator.referenceId === authUser.referenceId;
    const isOpponent = game.opponent?.referenceId === authUser.referenceId;

    if (!isCreator && !isOpponent) {
      return NextResponse.json(
        { success: false, error: "User is not part of this game" },
        { status: 403 }
      );
    }

    // 5. Update game with new state
    const updatedGame = await prisma.game.update({
      where: { referenceId: validatedData.gameReferenceId },
      data: {
        gameData: {
          ...(game.gameData as Record<string, unknown>),
          fen: validatedData.fen,
          moveHistory: validatedData.moveHistory,
        },
        creatorTimeRemaining: validatedData.whiteTime,
        opponentTimeRemaining: validatedData.blackTime,
        lastMoveAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // 6. Return success
    return NextResponse.json(
      {
        success: true,
        data: {
          game: {
            referenceId: updatedGame.referenceId,
            status: updatedGame.status,
            updatedAt: updatedGame.updatedAt,
          },
        },
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
    logger.error("Error persisting move", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to persist move",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

