import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveUser } from "@/lib/auth/resolve-user";
import {
  autoCompleteTournamentIfExpired,
  resolveStartingPosition,
} from "@/lib/services/tournament/tournament.service";
import { notifyTournamentEvent } from "@/lib/services/tournament/notify-websocket";

const findMatchSchema = z.object({
  tournamentReferenceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const dbUser = await resolveUser(request);
    if (!dbUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const data = findMatchSchema.parse(body);

    const tournament = await prisma.tournament.findUnique({
      where: { referenceId: data.tournamentReferenceId },
      include: {
        opening: {
          select: { referenceId: true, fen: true, name: true, eco: true },
        },
        legend: {
          select: { referenceId: true, name: true, profilePhotoUrl: true },
        },
        chessPosition: {
          select: {
            referenceId: true,
            fen: true,
            whitePlayerName: true,
            blackPlayerName: true,
          },
        },
      },
    });

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    // Auto-complete if expired
    const wasCompleted = await autoCompleteTournamentIfExpired(tournament);
    if (wasCompleted || tournament.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Tournament is not active" },
        { status: 400 }
      );
    }

    // Verify user is a participant
    const participant = await prisma.tournamentParticipant.findUnique({
      where: {
        tournamentId_userId: {
          tournamentId: tournament.id,
          userId: dbUser.id,
        },
      },
    });

    if (!participant) {
      return NextResponse.json(
        { error: "You are not a participant in this tournament" },
        { status: 403 }
      );
    }

    // Check for existing in-progress game in this tournament
    const activeGame = await prisma.game.findFirst({
      where: {
        tournamentId: tournament.id,
        status: "IN_PROGRESS",
        OR: [{ creatorId: dbUser.id }, { opponentId: dbUser.id }],
      },
    });

    if (activeGame) {
      return NextResponse.json({
        success: true,
        data: {
          status: "IN_GAME",
          gameReferenceId: activeGame.referenceId,
        },
      });
    }

    // Try to find an opponent using FOR UPDATE SKIP LOCKED
    type SearchingCandidate = {
      id: bigint;
      userId: bigint;
    };

    const result = await prisma.$transaction(
      async (tx) => {
        // Mark ourselves as searching
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { isSearching: true, searchingSince: new Date() },
        });

        // Find another searching participant (lock to prevent double-match)
        const opponents = await tx.$queryRaw<SearchingCandidate[]>`
          SELECT tp.id, tp."userId"
          FROM tournament_participants tp
          WHERE tp."tournamentId" = ${tournament.id}
            AND tp."isSearching" = true
            AND tp."userId" != ${dbUser.id}
          ORDER BY tp."searchingSince" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;

        const opponent = opponents[0] ?? null;
        if (!opponent) {
          return { status: "SEARCHING" as const };
        }

        // Found an opponent - clear both searching flags
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { isSearching: false, searchingSince: null },
        });
        await tx.tournamentParticipant.update({
          where: { id: opponent.id },
          data: { isSearching: false, searchingSince: null },
        });

        // Resolve starting position
        const positionData = await resolveStartingPosition(tournament);

        // Random color assignment
        const userIsWhite = Math.random() < 0.5;
        const whiteUserId = userIsWhite ? dbUser.id : opponent.userId;
        const blackUserId = userIsWhite ? opponent.userId : dbUser.id;

        // Create the game
        const game = await tx.game.create({
          data: {
            creatorId: whiteUserId,
            opponentId: blackUserId,
            chessPositionId: positionData.chessPositionId,
            openingId: positionData.openingId ?? null,
            startingFen: positionData.fen,
            initialTimeSeconds: tournament.initialTimeSeconds,
            incrementSeconds: tournament.incrementSeconds,
            creatorTimeRemaining: tournament.initialTimeSeconds,
            opponentTimeRemaining: tournament.initialTimeSeconds,
            expiresAt: tournament.endsAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
            status: "IN_PROGRESS",
            startedAt: new Date(),
            tournamentId: tournament.id,
            gameData: {
              gameMode: "tournament",
              tournamentReferenceId: tournament.referenceId,
              positionInfo: positionData.positionInfo,
              ...(positionData.openingInfo && {
                openingInfo: positionData.openingInfo,
              }),
            },
          },
        });

        // Get opponent info
        const opponentUser = await tx.user.findUnique({
          where: { id: opponent.userId },
          select: { referenceId: true, name: true, profilePictureUrl: true },
        });

        return {
          status: "MATCHED" as const,
          gameReferenceId: game.referenceId,
          opponent: opponentUser,
        };
      },
      { timeout: 15000 }
    );

    if (result.status === "MATCHED") {
      notifyTournamentEvent({
        event: "game_started",
        tournamentReferenceId: data.tournamentReferenceId,
        data: {
          gameReferenceId: result.gameReferenceId,
          white: { name: "", referenceId: "" },
          black: { name: "", referenceId: "" },
        },
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }
    logger.error("Error finding tournament match", error);
    return NextResponse.json(
      { error: "Failed to find match" },
      { status: 500 }
    );
  }
}
