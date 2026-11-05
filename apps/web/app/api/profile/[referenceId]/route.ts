import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";
import { logger } from "@/lib/logger";

const GAME_PLAYER_SELECT = {
  referenceId: true,
  name: true,
  profilePictureUrl: true,
  code: true,
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ referenceId: string }> }
) {
  try {
    const { referenceId } = await params;

    if (!referenceId) {
      throw new ValidationError("User reference ID is required", 400);
    }

    // Fetch user with stats and chess.com profile
    const user = await prisma.user.findUnique({
      where: { referenceId },
      include: {
        stats: true,
        chessComProfile: true,
      },
    });

    if (!user) {
      throw new ValidationError("User not found", 404);
    }

    if (!user.isActive) {
      throw new ValidationError("User profile is not available", 400);
    }

    // Fetch last 20 completed games where user is creator OR opponent
    const recentGames = await prisma.game.findMany({
      where: {
        status: "COMPLETED",
        OR: [{ creatorId: user.id }, { opponentId: user.id }],
      },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: {
        referenceId: true,
        result: true,
        initialTimeSeconds: true,
        incrementSeconds: true,
        completedAt: true,
        creatorId: true,
        opponentId: true,
        winnerId: true,
        creator: { select: GAME_PLAYER_SELECT },
        opponent: { select: GAME_PLAYER_SELECT },
      },
    });

    // Calculate win rate
    const winRate =
      user.stats && user.stats.totalGamesPlayed > 0
        ? (user.stats.gamesWon / user.stats.totalGamesPlayed) * 100
        : 0;

    // Transform games from profile user's perspective
    const games = recentGames.map((game) => {
      const isCreator = game.creatorId === user.id;
      const opponent = isCreator ? game.opponent : game.creator;

      let outcome: "win" | "loss" | "draw";
      if (game.result === "DRAW") {
        outcome = "draw";
      } else if (game.winnerId === user.id) {
        outcome = "win";
      } else {
        outcome = "loss";
      }

      return {
        referenceId: game.referenceId,
        opponent: opponent
          ? {
              name: opponent.name,
              profilePictureUrl: opponent.profilePictureUrl,
              code: opponent.code,
            }
          : null,
        outcome,
        result: game.result,
        timeControl: `${Math.floor(game.initialTimeSeconds / 60)}+${game.incrementSeconds}`,
        completedAt: game.completedAt,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          user: {
            referenceId: user.referenceId,
            code: user.code,
            name: user.name,
            profilePictureUrl: user.profilePictureUrl,
            createdAt: user.createdAt,
          },
          stats: user.stats
            ? {
                totalGamesPlayed: user.stats.totalGamesPlayed,
                gamesWon: user.stats.gamesWon,
                gamesLost: user.stats.gamesLost,
                gamesDrawn: user.stats.gamesDrawn,
                winRate: parseFloat(winRate.toFixed(1)),
                currentWinStreak: user.stats.currentWinStreak,
                longestWinStreak: user.stats.longestWinStreak,
                averageGameDuration: user.stats.averageGameDuration,
                lastPlayedAt: user.stats.lastPlayedAt,
              }
            : null,
          chessComProfile: user.chessComProfile
            ? {
                chessComHandle: user.chessComProfile.chessComHandle,
                rapidRating: user.chessComProfile.rapidRating,
                rapidBestRating: user.chessComProfile.rapidBestRating,
                blitzRating: user.chessComProfile.blitzRating,
                blitzBestRating: user.chessComProfile.blitzBestRating,
                bulletRating: user.chessComProfile.bulletRating,
                bulletBestRating: user.chessComProfile.bulletBestRating,
                dailyRating: user.chessComProfile.dailyRating,
                dailyBestRating: user.chessComProfile.dailyBestRating,
                lastSyncedAt: user.chessComProfile.lastSyncedAt,
              }
            : null,
          games,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details && { details: error.details }),
        },
        { status: error.statusCode }
      );
    }

    logger.error("Error fetching profile", error);
    return NextResponse.json(
      {
        error: "Failed to fetch profile",
      },
      { status: 500 }
    );
  }
}
