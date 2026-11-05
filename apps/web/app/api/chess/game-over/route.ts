import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { requireInternalRequest } from "@/lib/auth/resolve-user";
import { errorResponse, requestIdOf, validationErrorResponse } from "@/lib/auth/error-response";
import { logger } from "@/lib/logger";
import { trackUserAction } from "@/lib/metrics";
import { updateTournamentStandings } from "@/lib/services/tournament/tournament.service";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

// Socket server only (plan §3.2 H2, A12, AA F-02). Browsers get 401/403. The status flip is
// conditional (§8.7, ADB DB-04): a second call for the same game is a 409 and never counts
// stats or tournament points twice.

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
  // The final move list, including the decisive move (H6 #7, AS F-07). Optional so that a
  // socket build without it still works.
  moveHistory: z.array(z.any()).optional(),
});

// Bounded so a slow database never holds the socket's 8 s attempt open (H6 #9).
export const maxDuration = 10;

function storedHistoryLength(gameData: unknown): number {
  if (!gameData || typeof gameData !== "object") return 0;
  const history = (gameData as { moveHistory?: unknown }).moveHistory;
  return Array.isArray(history) ? history.length : 0;
}

/** Thrown inside the transaction when another call already ended the game. */
class GameNotInProgress extends Error {
  constructor() {
    super("Game is not in progress");
    this.name = "GameNotInProgress";
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireInternalRequest(request);
  if (denied) return denied;
  const requestId = requestIdOf(request);

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid_json", "The request body is not valid JSON.", { requestId });
    }
    const validatedData = gameOverSchema.parse(body);

    Sentry.setTag("game.referenceId", validatedData.gameReferenceId);
    trackUserAction("game_over");

    const game = await prisma.game.findUnique({
      where: { referenceId: validatedData.gameReferenceId },
      select: {
        creatorId: true,
        opponentId: true,
        status: true,
        tournamentId: true,
        tournament: { select: { referenceId: true } },
      },
    });

    if (!game) {
      return errorResponse("not_found", "Game not found.", { requestId });
    }
    // Fast path; the transaction below re-checks atomically.
    if (game.status !== "IN_PROGRESS") {
      return errorResponse("conflict", "The game is no longer in progress.", { requestId });
    }

    // winnerId is the winner's referenceId.
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

    const completed = await prisma.$transaction(
      async (tx) => {
        const transition = await tx.game.updateMany({
          where: { referenceId: validatedData.gameReferenceId, status: "IN_PROGRESS" },
          data: {
            status: "COMPLETED",
            result: validatedData.result,
            winnerId: winnerDbId,
            completedAt: new Date(),
            creatorTimeRemaining: validatedData.whiteTime,
            opponentTimeRemaining: validatedData.blackTime,
          },
        });
        if (transition.count === 0) throw new GameNotInProgress();

        // Read gameData after the flip: the row is now locked by this transaction, and the
        // move route only writes IN_PROGRESS games, so no persisted move can be lost.
        const current = await tx.game.findUnique({
          where: { referenceId: validatedData.gameReferenceId },
          select: { gameData: true },
        });
        const updatedGame = await tx.game.update({
          where: { referenceId: validatedData.gameReferenceId },
          data: {
            gameData: {
              ...(current?.gameData as Record<string, unknown> | null),
              fen: validatedData.fen,
              method: validatedData.method,
              // Never replace a stored history with a shorter one (same rule as the move route).
              ...(validatedData.moveHistory &&
              validatedData.moveHistory.length >= storedHistoryLength(current?.gameData)
                ? { moveHistory: validatedData.moveHistory }
                : {}),
            },
          },
          select: { referenceId: true, status: true, result: true },
        });

        await updateUserStats(tx, game.creatorId, game.opponentId, validatedData.result);

        if (game.tournamentId && game.opponentId) {
          await updateTournamentStandings(
            tx,
            game.tournamentId,
            game.creatorId,
            game.opponentId,
            validatedData.result,
          );
        }

        return updatedGame;
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );

    // Notify the socket server for tournament live updates, after the response is sent (§8.7).
    const tournamentReferenceId = game.tournament?.referenceId;
    if (tournamentReferenceId) {
      after(() =>
        notifyTournamentEvent({
          event: "game_ended",
          tournamentReferenceId,
          data: {
            gameReferenceId: validatedData.gameReferenceId,
            result: validatedData.result,
          },
        })
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          gameReferenceId: completed.referenceId,
          status: completed.status,
          result: completed.result,
        },
        message: "Game completed successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof GameNotInProgress) {
      return errorResponse("conflict", "The game is no longer in progress.", { requestId });
    }
    if (error instanceof z.ZodError) {
      return validationErrorResponse(error.issues, requestId);
    }

    logger.error("Error completing game", error);
    return errorResponse("internal", "Something went wrong", { requestId });
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
