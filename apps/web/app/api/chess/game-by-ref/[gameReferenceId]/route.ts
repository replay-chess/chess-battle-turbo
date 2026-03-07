import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameReferenceId: string }> }
) {
  try {
    const { gameReferenceId } = await params;

    logger.info(`GET /api/chess/game-by-ref/${gameReferenceId}`);

    if (!gameReferenceId) {
      return NextResponse.json(
        {
          success: false,
          error: "Game reference ID is required"
        },
        { status: 400 }
      );
    }

    const game = await prisma.game.findUnique({
      where: { referenceId: gameReferenceId },
      select: {
        referenceId: true,
        chessPositionId: true,
        startingFen: true,
        status: true,
        initialTimeSeconds: true,
        incrementSeconds: true,
        creatorTimeRemaining: true,
        opponentTimeRemaining: true,
        gameData: true,
        creator: {
          select: {
            referenceId: true,
            name: true,
            code: true,
            profilePictureUrl: true,
          },
        },
        opponent: {
          select: {
            referenceId: true,
            name: true,
            code: true,
            profilePictureUrl: true,
          },
        },
      },
    });

    if (!game) {
      return NextResponse.json(
        {
          success: false,
          error: "Game not found"
        },
        { status: 404 }
      );
    }

    // Transform to match GameData interface
    const response = {
      success: true,
      data: {
        referenceId: game.referenceId,
        creatorId: game.creator.referenceId,
        opponentId: game.opponent?.referenceId ?? null,
        chessPositionId: game.chessPositionId?.toString() ?? null,
        startingFen: game.startingFen,
        initialTimeSeconds: game.initialTimeSeconds,
        incrementSeconds: game.incrementSeconds,
        creatorTimeRemaining: game.creatorTimeRemaining,
        opponentTimeRemaining: game.opponentTimeRemaining,
        status: game.status,
        gameData: game.gameData as Record<string, unknown> | undefined,
        creator: {
          userReferenceId: game.creator.referenceId,
          name: game.creator.name,
          code: game.creator.code,
          profilePictureUrl: game.creator.profilePictureUrl,
        },
        ...(game.opponent && {
          opponent: {
            userReferenceId: game.opponent.referenceId,
            name: game.opponent.name,
            code: game.opponent.code,
            profilePictureUrl: game.opponent.profilePictureUrl,
          },
        }),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error(`GET /api/chess/game-by-ref failed: ${error instanceof Error ? error.message : "Unknown error"}`, error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error"
      },
      { status: 500 }
    );
  }
}
