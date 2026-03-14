import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "../../../../lib/prisma";
import { Chess, Move } from "chess.js";
import { logger } from "@/lib/logger";

interface AnalysisData {
  // Game info
  gameReferenceId: string;
  startingFen: string;
  userMoves: Move[];
  userColor: "w" | "b";
  gameResult: string | null;
  userGameOutcome: "win" | "loss" | "draw" | null;

  // Legend info
  legendMoves: Move[];
  moveNumberStart: number;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
  tournamentName: string | null;
  legendPgn: string | null;
  legendGameResult: "white_won" | "black_won" | "draw" | null;

  // Opening info
  openingName: string | null;
  openingEco: string | null;

  // Explanation
  explanation: unknown | null;
  explanationAudioUrl: string | null;

  // Position sharing
  chessPositionReferenceId: string | null;
  openingReferenceId: string | null;
}

/**
 * Parse result from gameMetadata JSON.
 * Supports various formats: "1-0", "white_won", "white", etc.
 */
function parseResultFromMetadata(
  gameMetadata: Record<string, unknown> | null
): "white_won" | "black_won" | "draw" | null {
  if (!gameMetadata) return null;

  const result = gameMetadata.result as string | undefined;
  if (!result) return null;

  const normalized = result.toLowerCase().trim();

  // Handle standard notation
  if (normalized === "1-0" || normalized === "white_won" || normalized === "white") {
    return "white_won";
  }
  if (normalized === "0-1" || normalized === "black_won" || normalized === "black") {
    return "black_won";
  }
  if (normalized === "1/2-1/2" || normalized === "draw" || normalized === "0.5-0.5") {
    return "draw";
  }

  return null;
}

/**
 * Determine user's game outcome based on game result and their role.
 */
function getUserGameOutcome(
  gameResult: string | null,
  isCreator: boolean
): "win" | "loss" | "draw" | null {
  if (!gameResult) return null;

  if (gameResult === "DRAW") return "draw";

  const creatorWon = gameResult === "CREATOR_WON" || gameResult === "OPPONENT_TIMEOUT";
  const opponentWon = gameResult === "OPPONENT_WON" || gameResult === "CREATOR_TIMEOUT";

  if (isCreator) {
    if (creatorWon) return "win";
    if (opponentWon) return "loss";
  } else {
    if (opponentWon) return "win";
    if (creatorWon) return "loss";
  }

  return null;
}

/**
 * Parse PGN to extract moves starting from a specific move number.
 * Returns moves from moveNumberStart onwards.
 */
function parsePgnFromMoveNumber(
  pgn: string,
  startingFen: string,
  moveNumberStart: number
): Move[] {
  try {
    // Create a game and load the full PGN
    const game = new Chess();
    game.loadPgn(pgn);

    // Get all moves from the game
    const allMoves = game.history({ verbose: true });

    // Calculate which ply to start from
    // Move number 31 with black to move means we start at ply (31-1)*2 + 1 = 61
    // Move number 31 with white to move means we start at ply (31-1)*2 = 60
    const fenParts = startingFen.split(" ");
    const sideToMove = fenParts[1]; // 'w' or 'b'

    let startPly: number;
    if (sideToMove === "b") {
      // Black to move: we're at the start of black's move in that move number
      startPly = (moveNumberStart - 1) * 2 + 1;
    } else {
      // White to move: we're at the start of white's move in that move number
      startPly = (moveNumberStart - 1) * 2;
    }

    // Return moves from startPly onwards
    return allMoves.slice(startPly);
  } catch (error) {
    logger.error("Error parsing PGN:", error);
    return [];
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  try {
    const { gameId } = await params;
    const { searchParams } = new URL(request.url);
    const userReferenceId = searchParams.get("userReferenceId");

    // 1. Find the game with its chess position
    const game = await prisma.game.findUnique({
      where: { referenceId: gameId },
      select: {
        referenceId: true,
        startingFen: true,
        gameData: true,
        result: true,
        creatorId: true,
        opponentId: true,
        chessPositionId: true,
        openingId: true,
      },
    });

    // Look up user if userReferenceId provided
    let currentUserId: bigint | null = null;
    if (userReferenceId) {
      const user = await prisma.user.findUnique({
        where: { referenceId: userReferenceId },
        select: { id: true },
      });
      currentUserId = user?.id ?? null;
    }

    if (!game) {
      return NextResponse.json(
        { success: false, error: "Game not found" },
        { status: 404 }
      );
    }

    // 1b. Auth gate: unauthenticated users can only access demo games
    const { userId } = await auth();
    if (!userId) {
      const gd = game.gameData as { isDemo?: boolean } | null;
      if (!gd?.isDemo) {
        return NextResponse.json(
          { success: false, error: "Authentication required" },
          { status: 403 }
        );
      }
    }

    // 2. Extract user moves from gameData
    const gameData = game.gameData as {
      moveHistory?: Move[];
      playerColor?: string;
      positionInfo?: {
        whitePlayerName?: string;
        blackPlayerName?: string;
        tournamentName?: string;
        openingName?: string;
        openingEco?: string;
      };
      openingInfo?: {
        referenceId?: string;
        name?: string;
        eco?: string;
        pgn?: string;
        moveCount?: number;
      };
    } | null;

    const userMoves = gameData?.moveHistory || [];
    // Determine user color: prefer gameData.playerColor, fall back to creator/opponent relationship
    // (creator = white player in AI games)
    let userColor: "w" | "b" = "w";
    if (gameData?.playerColor === "black" || gameData?.playerColor === "b") {
      userColor = "b";
    } else if (gameData?.playerColor === "white" || gameData?.playerColor === "w") {
      userColor = "w";
    } else if (currentUserId) {
      // Fallback: creator plays white, opponent plays black
      userColor = currentUserId === game.creatorId ? "w" : "b";
    }

    // 3. If game has a chess position, fetch it for legend data
    let legendMoves: Move[] = [];
    let moveNumberStart = 1;
    let whitePlayerName: string | null = null;
    let blackPlayerName: string | null = null;
    let tournamentName: string | null = null;
    let legendPgn: string | null = null;

    let positionGameMetadata: Record<string, unknown> | null = null;
    let explanation: unknown | null = null;
    let explanationAudioUrl: string | null = null;
    let chessPositionReferenceId: string | null = null;

    if (game.chessPositionId) {
      const chessPosition = await prisma.chessPosition.findUnique({
        where: { id: game.chessPositionId },
        select: {
          referenceId: true,
          pgn: true,
          moveNumber: true,
          whitePlayerName: true,
          blackPlayerName: true,
          tournamentName: true,
          fen: true,
          gameMetadata: true,
          explanation: true,
          explanationAudioUrl: true,
        },
      });

      if (chessPosition) {
        chessPositionReferenceId = chessPosition.referenceId;
        whitePlayerName = chessPosition.whitePlayerName;
        blackPlayerName = chessPosition.blackPlayerName;
        tournamentName = chessPosition.tournamentName;
        legendPgn = chessPosition.pgn;
        moveNumberStart = chessPosition.moveNumber || 1;
        positionGameMetadata = chessPosition.gameMetadata as Record<string, unknown> | null;
        explanation = chessPosition.explanation;
        explanationAudioUrl = chessPosition.explanationAudioUrl;

        if (chessPosition.pgn) {
          legendMoves = parsePgnFromMoveNumber(
            chessPosition.pgn,
            game.startingFen,
            moveNumberStart
          );
        }
      }
    } else if (gameData?.positionInfo) {
      // Fallback to positionInfo stored in gameData
      whitePlayerName = gameData.positionInfo.whitePlayerName || null;
      blackPlayerName = gameData.positionInfo.blackPlayerName || null;
      tournamentName = gameData.positionInfo.tournamentName || null;
    }

    // If game has an opening, fetch explanation from Opening table
    // Prefer openingId FK (fast PK lookup), fall back to gameData referenceId for backward compat
    if (!explanation) {
      const openingWhere = game.openingId
        ? { id: game.openingId }
        : gameData?.openingInfo?.referenceId
          ? { referenceId: gameData.openingInfo.referenceId }
          : null;

      if (openingWhere) {
        const opening = await prisma.opening.findUnique({
          where: openingWhere,
          select: {
            explanation: true,
            explanationAudioUrl: true,
          },
        });

        if (opening) {
          explanation = opening.explanation;
          explanationAudioUrl = opening.explanationAudioUrl;
        }
      }
    }

    // 4. Determine user game outcome
    let userGameOutcome: "win" | "loss" | "draw" | null = null;
    if (currentUserId && game.result) {
      const isCreator = currentUserId === game.creatorId;
      userGameOutcome = getUserGameOutcome(game.result, isCreator);
    }

    // 5. Extract legend game result from gameMetadata
    const legendGameResult = parseResultFromMetadata(positionGameMetadata);

    // 5b. Extract opening info from gameData
    const openingName = gameData?.openingInfo?.name || gameData?.positionInfo?.openingName || null;
    const openingEco = gameData?.openingInfo?.eco || gameData?.positionInfo?.openingEco || null;

    // 5c. Extract position referenceIds for sharing
    const openingReferenceId = gameData?.openingInfo?.referenceId ?? null;

    // 6. Build response
    const analysisData: AnalysisData = {
      gameReferenceId: game.referenceId,
      startingFen: game.startingFen,
      userMoves,
      userColor,
      gameResult: game.result,
      userGameOutcome,
      legendMoves,
      moveNumberStart,
      whitePlayerName,
      blackPlayerName,
      tournamentName,
      legendPgn,
      legendGameResult,
      openingName,
      openingEco,
      explanation,
      explanationAudioUrl,
      chessPositionReferenceId,
      openingReferenceId,
    };

    return NextResponse.json({
      success: true,
      data: analysisData,
    });
  } catch (error) {
    logger.error("Error fetching analysis data:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch analysis data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
