import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import {
  getRandomChessPosition,
  getRandomPositionByLegend,
} from "@/lib/services/chess-position.service";
import { getOpeningByReferenceId } from "@/lib/services/opening.service";

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const DEFAULT_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Fetch tournament by referenceId with participants + user info, sorted by points
 */
export async function getTournamentByRef(referenceId: string) {
  return prisma.tournament.findUnique({
    where: { referenceId },
    include: {
      createdBy: {
        select: {
          referenceId: true,
          name: true,
          profilePictureUrl: true,
        },
      },
      opening: {
        select: {
          referenceId: true,
          name: true,
          eco: true,
          fen: true,
        },
      },
      legend: {
        select: {
          referenceId: true,
          name: true,
          profilePhotoUrl: true,
        },
      },
      chessPosition: {
        select: {
          referenceId: true,
          fen: true,
          whitePlayerName: true,
          blackPlayerName: true,
        },
      },
      _count: { select: { participants: true } },
      participants: {
        take: 100,
        include: {
          user: {
            select: {
              referenceId: true,
              name: true,
              profilePictureUrl: true,
            },
          },
        },
        orderBy: [{ points: "desc" }, { wins: "desc" }, { gamesPlayed: "asc" }],
      },
    },
  });
}

/**
 * Auto-complete tournament if endsAt has passed
 */
export async function autoCompleteTournamentIfExpired(
  tournament: { id: bigint; status: string; endsAt: Date | null }
) {
  if (
    tournament.status === "ACTIVE" &&
    tournament.endsAt &&
    tournament.endsAt < new Date()
  ) {
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    // Also clear any searching participants
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: tournament.id, isSearching: true },
      data: { isSearching: false, searchingSince: null },
    });
    return true;
  }
  return false;
}

/**
 * Resolve starting position based on tournament mode
 */
export async function resolveStartingPosition(tournament: {
  mode: string;
  openingId: bigint | null;
  legendId: bigint | null;
  chessPositionId: bigint | null;
  opening?: { referenceId: string; fen: string; name: string; eco: string } | null;
  legend?: { referenceId: string; name: string } | null;
  chessPosition?: { referenceId: string; fen: string; whitePlayerName: string | null; blackPlayerName: string | null } | null;
}) {
  switch (tournament.mode) {
    case "OPENING": {
      if (tournament.opening) {
        const opening = await getOpeningByReferenceId(tournament.opening.referenceId);
        if (opening) {
          return {
            fen: opening.fen,
            chessPositionId: null,
            openingId: opening.id,
            positionInfo: {
              whitePlayerName: null,
              blackPlayerName: null,
              tournamentName: null,
              openingName: opening.name,
              openingEco: opening.eco,
              whitePlayerImageUrl: null,
              blackPlayerImageUrl: null,
            },
            openingInfo: {
              referenceId: opening.referenceId,
              name: opening.name,
              eco: opening.eco,
              pgn: opening.pgn,
              moveCount: opening.moveCount,
            },
          };
        }
      }
      break;
    }
    case "LEGEND": {
      if (tournament.legend) {
        const position = await getRandomPositionByLegend(
          tournament.legend.referenceId
        );
        if (position) {
          return {
            fen: position.fen,
            chessPositionId: position.id,
            openingId: null,
            positionInfo: {
              whitePlayerName: position.whitePlayerName ?? null,
              blackPlayerName: position.blackPlayerName ?? null,
              tournamentName: position.tournamentName ?? null,
              whitePlayerImageUrl:
                position.whiteLegend?.profilePhotoUrl ?? null,
              blackPlayerImageUrl:
                position.blackLegend?.profilePhotoUrl ?? null,
            },
            openingInfo: null,
          };
        }
      }
      break;
    }
    case "ENDGAME": {
      if (tournament.chessPosition) {
        return {
          fen: tournament.chessPosition.fen,
          chessPositionId: tournament.chessPositionId,
          openingId: null,
          positionInfo: {
            whitePlayerName: tournament.chessPosition.whitePlayerName ?? null,
            blackPlayerName: tournament.chessPosition.blackPlayerName ?? null,
            tournamentName: null,
            whitePlayerImageUrl: null,
            blackPlayerImageUrl: null,
          },
          openingInfo: null,
        };
      }
      break;
    }
  }

  // FREE mode or fallback
  const randomPosition = await getRandomChessPosition();
  if (randomPosition) {
    return {
      fen: randomPosition.fen,
      chessPositionId: randomPosition.id,
      openingId: null,
      positionInfo: {
        whitePlayerName: randomPosition.whitePlayerName ?? null,
        blackPlayerName: randomPosition.blackPlayerName ?? null,
        tournamentName: randomPosition.tournamentName ?? null,
        whitePlayerImageUrl:
          randomPosition.whiteLegend?.profilePhotoUrl ?? null,
        blackPlayerImageUrl:
          randomPosition.blackLegend?.profilePhotoUrl ?? null,
      },
      openingInfo: null,
    };
  }

  return {
    fen: DEFAULT_FEN,
    chessPositionId: null,
    openingId: null,
    positionInfo: null,
    openingInfo: null,
  };
}

/**
 * Update tournament standings after a game ends.
 * Called inside the game-over transaction.
 */
export async function updateTournamentStandings(
  tx: TransactionClient,
  tournamentId: bigint,
  creatorId: bigint,
  opponentId: bigint,
  result: string
) {
  const creatorParticipant = await tx.tournamentParticipant.findFirst({
    where: { tournamentId, userId: creatorId },
  });
  const opponentParticipant = await tx.tournamentParticipant.findFirst({
    where: { tournamentId, userId: opponentId },
  });

  if (!creatorParticipant || !opponentParticipant) return;

  if (result === "DRAW") {
    await tx.tournamentParticipant.update({
      where: { id: creatorParticipant.id },
      data: {
        points: { increment: new Decimal("0.5") },
        draws: { increment: 1 },
        gamesPlayed: { increment: 1 },
      },
    });
    await tx.tournamentParticipant.update({
      where: { id: opponentParticipant.id },
      data: {
        points: { increment: new Decimal("0.5") },
        draws: { increment: 1 },
        gamesPlayed: { increment: 1 },
      },
    });
  } else {
    const creatorWon =
      result === "CREATOR_WON" || result === "OPPONENT_TIMEOUT";

    const winnerId = creatorWon
      ? creatorParticipant.id
      : opponentParticipant.id;
    const loserId = creatorWon
      ? opponentParticipant.id
      : creatorParticipant.id;

    await tx.tournamentParticipant.update({
      where: { id: winnerId },
      data: {
        points: { increment: new Decimal("1") },
        wins: { increment: 1 },
        gamesPlayed: { increment: 1 },
      },
    });
    await tx.tournamentParticipant.update({
      where: { id: loserId },
      data: {
        losses: { increment: 1 },
        gamesPlayed: { increment: 1 },
      },
    });
  }
}

/**
 * Serialize tournament data for JSON response (handles BigInt/Decimal)
 */
export function serializeTournament(tournament: NonNullable<Awaited<ReturnType<typeof getTournamentByRef>>>) {
  return {
    referenceId: tournament.referenceId,
    name: tournament.name,
    description: tournament.description,
    mode: tournament.mode,
    status: tournament.status,
    maxParticipants: tournament.maxParticipants,
    initialTimeSeconds: tournament.initialTimeSeconds,
    incrementSeconds: tournament.incrementSeconds,
    durationMinutes: tournament.durationMinutes,
    scheduledStartAt: tournament.scheduledStartAt.toISOString(),
    startedAt: tournament.startedAt?.toISOString() ?? null,
    endsAt: tournament.endsAt?.toISOString() ?? null,
    completedAt: tournament.completedAt?.toISOString() ?? null,
    createdAt: tournament.createdAt.toISOString(),
    createdBy: tournament.createdBy,
    opening: tournament.opening,
    legend: tournament.legend,
    chessPosition: tournament.chessPosition
      ? {
          referenceId: tournament.chessPosition.referenceId,
          fen: tournament.chessPosition.fen,
          whitePlayerName: tournament.chessPosition.whitePlayerName,
          blackPlayerName: tournament.chessPosition.blackPlayerName,
        }
      : null,
    participants: tournament.participants.map((p) => ({
      referenceId: p.referenceId,
      points: p.points.toString(),
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      gamesPlayed: p.gamesPlayed,
      isSearching: p.isSearching,
      joinedAt: p.joinedAt.toISOString(),
      user: p.user,
    })),
    participantCount: tournament._count.participants,
  };
}

/**
 * Get current user's participant row with computed rank
 */
export async function getCurrentUserParticipant(
  tournamentId: bigint,
  userId: bigint
) {
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
    include: {
      user: {
        select: { referenceId: true, name: true, profilePictureUrl: true },
      },
    },
  });

  if (!participant) return null;

  // Compute rank: count participants strictly ahead in the sort order
  const aheadCount = await prisma.tournamentParticipant.count({
    where: {
      tournamentId,
      OR: [
        { points: { gt: participant.points } },
        {
          points: participant.points,
          wins: { gt: participant.wins },
        },
        {
          points: participant.points,
          wins: participant.wins,
          gamesPlayed: { lt: participant.gamesPlayed },
        },
        {
          points: participant.points,
          wins: participant.wins,
          gamesPlayed: participant.gamesPlayed,
          id: { lt: participant.id },
        },
      ],
    },
  });

  return {
    rank: aheadCount + 1,
    referenceId: participant.referenceId,
    points: participant.points.toString(),
    wins: participant.wins,
    losses: participant.losses,
    draws: participant.draws,
    gamesPlayed: participant.gamesPlayed,
    isSearching: participant.isSearching,
    joinedAt: participant.joinedAt.toISOString(),
    user: participant.user,
  };
}

/**
 * Search tournament participants by name with computed ranks
 */
export async function searchTournamentParticipants(
  tournamentId: bigint,
  query: string
) {
  const results: Array<{
    referenceId: string;
    points: string;
    wins: number;
    losses: number;
    draws: number;
    gamesPlayed: number;
    isSearching: boolean;
    joinedAt: Date;
    userReferenceId: string;
    name: string;
    profilePictureUrl: string | null;
    rank: bigint;
  }> = await prisma.$queryRaw`
    WITH ranked AS (
      SELECT tp."referenceId", tp.points, tp.wins, tp.losses, tp.draws,
             tp."gamesPlayed", tp."isSearching", tp."joinedAt",
             u."referenceId" AS "userReferenceId", u.name, u."profilePictureUrl",
             ROW_NUMBER() OVER (ORDER BY tp.points DESC, tp.wins DESC, tp."gamesPlayed" ASC) AS rank
      FROM tournament_participants tp
      JOIN users u ON u.id = tp."userId"
      WHERE tp."tournamentId" = ${tournamentId}
    )
    SELECT * FROM ranked WHERE name ILIKE ${'%' + query + '%'} LIMIT 20
  `;

  return results.map((r) => ({
    rank: Number(r.rank),
    referenceId: r.referenceId,
    points: r.points.toString(),
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    gamesPlayed: r.gamesPlayed,
    isSearching: r.isSearching,
    joinedAt: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : String(r.joinedAt),
    user: {
      referenceId: r.userReferenceId,
      name: r.name,
      profilePictureUrl: r.profilePictureUrl,
    },
  }));
}
