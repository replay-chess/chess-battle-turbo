import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import * as Sentry from "@sentry/nextjs";
import {prisma} from "@/lib/prisma";
import {getRandomChessPosition, getRandomPositionByLegend, incrementPositionPlayCount} from "@/lib/services/chess-position.service";
import { getOpeningByReferenceId, getOpeningPlayerColor } from "@/lib/services/opening.service";
import { ValidationError } from "@/lib/errors/validation-error";
import { validateAndFetchUser } from "@/lib/services/user-validation.service";
import { captureGameTraceData } from "@/lib/sentry/game-trace";
import { logger } from "@/lib/logger";
import { trackUserAction } from "@/lib/metrics";

const createGameSchema = z.object({
  userReferenceId: z.string().min(1, "User reference ID is required"),
  initialTimeSeconds: z.number().int().positive("Initial time must be greater than 0"),
  incrementSeconds: z.number().int().min(0, "Increment seconds must be 0 or greater"),
  gameMode: z.enum(["quick", "friend", "ai"]),
  playAsLegend: z.boolean(),
  selectedLegend: z.string().nullable(),
  selectedOpening: z.string().nullable().optional(),
});

function calculateExpirationTime(hoursFromNow: number = 1): Date {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
}

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body using Zod schema
    const body = await request.json();
    const validatedData = createGameSchema.parse(body);

    // 2. Validate user exists and is active
    const user = await validateAndFetchUser(validatedData.userReferenceId);

    // 3. Fetch chess position, opening, or legend position
    const DEFAULT_STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    let chessPosition;
    let legendPosition: Awaited<ReturnType<typeof getRandomPositionByLegend>> = null;
    let opening: Awaited<ReturnType<typeof getOpeningByReferenceId>> = null;

    if (validatedData.selectedOpening) {
      opening = await getOpeningByReferenceId(validatedData.selectedOpening);
    } else if (validatedData.playAsLegend && validatedData.selectedLegend) {
      legendPosition = await getRandomPositionByLegend(validatedData.selectedLegend);
      chessPosition = legendPosition;

      if (!chessPosition) {
        chessPosition = await getRandomChessPosition();
      }
    } else {
      chessPosition = await getRandomChessPosition();
    }

    const chessPositionId = opening ? null : (chessPosition?.id ?? null);
    const startingFen = opening ? opening.fen : (chessPosition?.fen ?? DEFAULT_STARTING_FEN);

    // 4. Build position info for display
    let positionInfo;
    if (opening) {
      positionInfo = {
        whitePlayerName: null,
        blackPlayerName: null,
        tournamentName: null,
        openingName: opening.name,
        openingEco: opening.eco,
        whitePlayerImageUrl: null,
        blackPlayerImageUrl: null,
      };
    } else if (chessPosition) {
      positionInfo = {
        whitePlayerName: chessPosition.whitePlayerName ?? null,
        blackPlayerName: chessPosition.blackPlayerName ?? null,
        tournamentName: chessPosition.tournamentName ?? null,
        whitePlayerImageUrl: chessPosition.whiteLegend?.profilePhotoUrl ?? null,
        blackPlayerImageUrl: chessPosition.blackLegend?.profilePhotoUrl ?? null,
      };
    } else {
      positionInfo = null;
    }

    // 5. Capture Sentry trace context for distributed tracing
    const traceData = captureGameTraceData();

    // 5b. Determine creator color and build extra game data
    const extraGameData: Record<string, unknown> = {};
    if (traceData) {
      extraGameData.traceContext = traceData;
    }
    if (opening) {
      extraGameData.creatorColor = getOpeningPlayerColor(opening.sideToMove);
      extraGameData.selectedOpening = validatedData.selectedOpening;
      extraGameData.openingInfo = {
        referenceId: opening.referenceId,
        name: opening.name,
        eco: opening.eco,
        pgn: opening.pgn,
        moveCount: opening.moveCount,
      };
    } else if (legendPosition && legendPosition.legendId) {
      if (legendPosition.whitePlayerId === legendPosition.legendId) {
        extraGameData.creatorColor = "white";
      } else {
        extraGameData.creatorColor = "black";
      }
    }

    // 6. Create the game
    const expiresAt = calculateExpirationTime(1);
    const game = await prisma.game.create({
      data: {
        creatorId: user.id,
        chessPositionId,
        startingFen,
        initialTimeSeconds: validatedData.initialTimeSeconds,
        incrementSeconds: validatedData.incrementSeconds,
        creatorTimeRemaining: validatedData.initialTimeSeconds,
        opponentTimeRemaining: validatedData.initialTimeSeconds,
        expiresAt,
        status: "WAITING_FOR_OPPONENT",
        gameData: {
          gameMode: validatedData.gameMode,
          playAsLegend: validatedData.playAsLegend,
          selectedLegend: validatedData.selectedLegend,
          positionInfo: positionInfo,
          ...extraGameData,
        },
      },
    });

    // 7. Increment position play count if a position was used
    if (chessPositionId) {
      await incrementPositionPlayCount(chessPositionId);
    }

    // 8. Tag for Sentry filtering
    Sentry.setTag("game.referenceId", game.referenceId);
    trackUserAction("create_game");

    // 9. Return success response
    return NextResponse.json(
      {
        success: true,
        message: "Game created successfully",
        data: {
          game: {
            referenceId: game.referenceId,
            startingFen: game.startingFen,
            chessPositionId: game.chessPositionId?.toString() ?? null,
            initialTimeSeconds: game.initialTimeSeconds,
            incrementSeconds: game.incrementSeconds,
            status: game.status,
            expiresAt: game.expiresAt,
            createdAt: game.createdAt,
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
    logger.error("Error creating game", error);
    return NextResponse.json(
      {
        error: "Failed to create game",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
