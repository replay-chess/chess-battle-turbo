import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "../../../../lib/prisma";
import { logger } from "@/lib/sentry/logger";
import { trackUserAction } from "@/lib/metrics";
import { updateTournamentStandings } from "@/lib/services/tournament/tournament.service";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

interface StatsUpdateData {
  totalGamesPlayed?: { increment: number };
  lastPlayedAt?: Date;
  gamesWon?: { increment: number };
  gamesLost?: { increment: number };
  gamesDrawn?: { increment: number };
  currentWinStreak?: number | { increment: number };
  longestWinStreak?: number;
}

const gameOverSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  result: z.enum([
    "CREATOR_WON",
    "OPPONENT_WON",
    "DRAW",
    "CREATOR_TIMEOUT",
    "OPPONENT_TIMEOUT",
  ]),
  winnerId: z.string().optional(),
  method: z.enum([
    "checkmate",
    "timeout",
    "resignation",
    "draw_agreement",
    "stalemate",
    "insufficient_material",
  ]),
  fen: z.string().min(1),
  whiteTime: z.number().int().min(0),
  blackTime: z.number().int().min(0),
});

type GameOverRequest = z.infer<typeof gameOverSchema>;

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const validatedData = gameOverSchema.parse(body);

    Sentry.setTag("game.referenceId", validatedData.gameReferenceId);
    trackUserAction("game_over");

    // 2. Find game
    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
      include: {
        tournament: { select: { referenceId: true } },
      },
    });

    if (!game) {
      return NextResponse.json(
        { success: false, error: "Game not found" },
        { status: 404 }
      );
    }

    // 3. Verify game is in progress
    if (game.status !== "IN_PROGRESS") {
      return NextResponse.json(
        { success: false, error: "Game is not in progress" },
        { status: 400 }
      );
    }

    // 4. Get winner's database ID if provided (winnerId is referenceId from API)
    let winnerDbId: bigint | null = null;
    if (validatedData.winnerId) {
      const winner = await prisma.user.findUnique({
        where: { referenceId: validatedData.winnerId },
        select: { id: true },
      });
      if (winner) {
        winnerDbId = winner.id;
      }
    }

    // 5. Execute transaction to complete game and update stats
    const result = await prisma.$transaction(async (tx) => {
      // Update game status
      const updatedGame = await tx.game.update({
        where: { referenceId: validatedData.gameReferenceId },
        data: {
          status: "COMPLETED",
          result: validatedData.result,
          winnerId: winnerDbId,
          completedAt: new Date(),
          creatorTimeRemaining: validatedData.whiteTime,
          opponentTimeRemaining: validatedData.blackTime,
          gameData: {
            ...(game.gameData as any),
            fen: validatedData.fen,
            method: validatedData.method,
          },
        },
      });

      // Update user stats
      await updateUserStats(
        tx,
        game.creatorId,
        game.opponentId,
        validatedData.result
      );

      // If this is a tournament game, update standings
      if (game.tournamentId && game.opponentId) {
        await updateTournamentStandings(
          tx,
          game.tournamentId,
          game.creatorId,
          game.opponentId,
          validatedData.result
        );
      }

      return { game: updatedGame };
    }, {
      maxWait: 10000,
      timeout: 15000,
    });

    // 6. Notify WebSocket server for tournament live updates (fire-and-forget)
    if (game.tournament?.referenceId) {
      notifyTournamentEvent({
        event: "game_ended",
        tournamentReferenceId: game.tournament.referenceId,
        data: {
          gameReferenceId: validatedData.gameReferenceId,
          result: validatedData.result,
        },
      });
    }

    // 7. Return success
    return NextResponse.json(
      {
        success: true,
        data: {
          gameReferenceId: result.game.referenceId,
          status: result.game.status,
          result: result.game.result,
        },
        message: "Game completed successfully",
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
    logger.error("Error completing game", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to complete game",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function updateUserStats(
  tx: TransactionClient,
  creatorId: bigint,
  opponentId: bigint | null,
  result: string
) {
  // Update creator stats
  const creatorStats = await tx.userStats.findUnique({
    where: { userId: creatorId },
  });

  if (creatorStats) {
    const creatorUpdate: StatsUpdateData = {
      totalGamesPlayed: { increment: 1 },
      lastPlayedAt: new Date(),
    };

    if (result === "CREATOR_WON" || result === "OPPONENT_TIMEOUT") {
      creatorUpdate.gamesWon = { increment: 1 };
      creatorUpdate.currentWinStreak = { increment: 1 };
      if (
        creatorStats.currentWinStreak + 1 >
        creatorStats.longestWinStreak
      ) {
        creatorUpdate.longestWinStreak = creatorStats.currentWinStreak + 1;
      }
    } else if (result === "DRAW") {
      creatorUpdate.gamesDrawn = { increment: 1 };
      creatorUpdate.currentWinStreak = 0;
    } else {
      creatorUpdate.gamesLost = { increment: 1 };
      creatorUpdate.currentWinStreak = 0;
    }

    await tx.userStats.update({
      where: { userId: creatorId },
      data: creatorUpdate,
    });
  }

  // Update opponent stats
  if (opponentId) {
    const opponentStats = await tx.userStats.findUnique({
      where: { userId: opponentId },
    });

    if (opponentStats) {
      const opponentUpdate: StatsUpdateData = {
        totalGamesPlayed: { increment: 1 },
        lastPlayedAt: new Date(),
      };

      if (result === "OPPONENT_WON" || result === "CREATOR_TIMEOUT") {
        opponentUpdate.gamesWon = { increment: 1 };
        opponentUpdate.currentWinStreak = { increment: 1 };
        if (
          opponentStats.currentWinStreak + 1 >
          opponentStats.longestWinStreak
        ) {
          opponentUpdate.longestWinStreak = opponentStats.currentWinStreak + 1;
        }
      } else if (result === "DRAW") {
        opponentUpdate.gamesDrawn = { increment: 1 };
        opponentUpdate.currentWinStreak = 0;
      } else {
        opponentUpdate.gamesLost = { increment: 1 };
        opponentUpdate.currentWinStreak = 0;
      }

      await tx.userStats.update({
        where: { userId: opponentId },
        data: opponentUpdate,
      });
    }
  }
}
