import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";
import { validateAndFetchUser } from "@/lib/services/user-validation.service";
import { logger } from "@/lib/sentry/logger";
import { trackUserAction } from "@/lib/metrics";

const joinGameSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  opponentReferenceId: z.string().min(1, "Opponent reference ID is required"),
});

async function validateAndFetchGame(gameReferenceId: string) {
  const game = await prisma.game.findUnique({
    where: { referenceId: gameReferenceId },
    include: {
      creator: {
        select: {
          id: true,
          referenceId: true,
          name: true,
          profilePictureUrl: true,
          code: true,
        },
      },
    },
  });

  if (!game) {
    throw new ValidationError("Game not found", 404);
  }

  if (game.status !== "WAITING_FOR_OPPONENT") {
    throw new ValidationError(
      `This game is not available to join. Current status: ${game.status}`,
      400,
      { currentStatus: game.status }
    );
  }

  const now = new Date();
  if (game.expiresAt < now) {
    throw new ValidationError(
      "This game invitation has expired",
      400,
      { expiresAt: game.expiresAt }
    );
  }

  return game;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const validatedData = joinGameSchema.parse(body);
    logger.info(`Join game request: game=${validatedData.gameReferenceId}`);

    // 2. Fetch and validate game
    const game = await validateAndFetchGame(validatedData.gameReferenceId);

    // 2b. Continue the game's distributed trace if trace context is available
    const traceContext = (game.gameData as any)?.traceContext;
    Sentry.setTag("game.referenceId", game.referenceId);

    trackUserAction("join_game");

    const executeJoin = async () => {
      // 3. Fetch and validate opponent
      const opponent = await validateAndFetchUser(validatedData.opponentReferenceId);

      // 4. Prevent self-play
      if (game.creatorId === opponent.id) {
        throw new ValidationError("You cannot join your own game", 400);
      }

      // 5. Update game - set opponent and change status to IN_PROGRESS
      const updatedGame = await prisma.game.update({
        where: { id: game.id },
        data: {
          opponentId: opponent.id,
          status: "IN_PROGRESS",
          startedAt: new Date(),
        },
        include: {
          creator: {
            select: {
              referenceId: true,
              name: true,
              profilePictureUrl: true,
              code: true,
            },
          },
          opponent: {
            select: {
              referenceId: true,
              name: true,
              profilePictureUrl: true,
              code: true,
            },
          },
        },
      });

      // 6. Return success response
      return NextResponse.json(
        {
          success: true,
          message: "Successfully joined the game",
          data: {
            game: {
              referenceId: updatedGame.referenceId,
              status: updatedGame.status,
              initialTimeSeconds: updatedGame.initialTimeSeconds,
              incrementSeconds: updatedGame.incrementSeconds,
              timeControl: {
                format: `${updatedGame.initialTimeSeconds / 60}+${updatedGame.incrementSeconds}`,
              },
              creator: updatedGame.creator,
              opponent: updatedGame.opponent,
              startedAt: updatedGame.startedAt,
              expiresAt: updatedGame.expiresAt,
              createdAt: updatedGame.createdAt,
            },
          },
        },
        { status: 200 }
      );
    };

    // Link to the game's original trace if trace context is available
    if (traceContext?.sentryTrace) {
      return await Sentry.continueTrace(
        {
          sentryTrace: traceContext.sentryTrace,
          baggage: traceContext.baggage || "",
        },
        executeJoin
      );
    }

    return await executeJoin();
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

    // Handle custom validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details && { details: error.details }),
        },
        { status: error.statusCode }
      );
    }

    // Handle unexpected errors
    logger.error("Error joining game", error);
    return NextResponse.json(
      {
        error: "Failed to join game",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
