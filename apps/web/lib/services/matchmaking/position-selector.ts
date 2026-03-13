import { prisma } from "@/lib/prisma";
import { MatchedPosition } from "./types";

const DEFAULT_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Selects a random chess position from either player's legend
 * If no legends specified, returns a random active position
 * If no positions found, returns null (caller should use DEFAULT_FEN)
 */
export async function selectPositionFromLegends(
  legendRef1: string | null | undefined,
  legendRef2: string | null | undefined
): Promise<MatchedPosition | null> {
  const legendRefs = [legendRef1, legendRef2].filter(Boolean) as string[];

  if (legendRefs.length === 0) {
    // No legends specified - get random active position
    return getRandomChessPosition();
  }

  // First, look up legend IDs from reference IDs
  const legends = await prisma.legend.findMany({
    where: { referenceId: { in: legendRefs } },
    select: { id: true },
  });

  const legendIds = legends.map((l) => l.id);

  if (legendIds.length === 0) {
    // Legends not found - fall back to random position
    return getRandomChessPosition();
  }

  // Get positions where either legend played (as white or black)
  const positions = await prisma.chessPosition.findMany({
    where: {
      isActive: true,
      OR: [
        { whitePlayerId: { in: legendIds } },
        { blackPlayerId: { in: legendIds } },
      ],
    },
    select: {
      id: true,
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      tournamentName: true,
      whiteLegend: {
        select: { profilePhotoUrl: true },
      },
      blackLegend: {
        select: { profilePhotoUrl: true },
      },
    },
  });

  if (positions.length === 0) {
    // No positions found for these legends - fall back to random
    return getRandomChessPosition();
  }

  // Return random position from the matching ones
  const randomIndex = Math.floor(Math.random() * positions.length);
  return positions[randomIndex] as MatchedPosition;
}

/**
 * Fetches a random active chess position from the database
 */
export async function getRandomChessPosition(): Promise<MatchedPosition | null> {
  const count = await prisma.chessPosition.count({
    where: { isActive: true },
  });

  if (count === 0) {
    return null;
  }

  const skip = Math.floor(Math.random() * count);

  const position = await prisma.chessPosition.findFirst({
    where: { isActive: true },
    skip,
    select: {
      id: true,
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      tournamentName: true,
      whiteLegend: {
        select: { profilePhotoUrl: true },
      },
      blackLegend: {
        select: { profilePhotoUrl: true },
      },
    },
  });

  return position as MatchedPosition | null;
}

/**
 * Fetches an opening by referenceId for matchmaking
 */
export async function selectOpeningPosition(
  openingReferenceId: string
): Promise<{
  id: bigint;
  referenceId: string;
  name: string;
  eco: string;
  fen: string;
  pgn: string;
  moveCount: number;
} | null> {
  const opening = await prisma.opening.findFirst({
    where: { referenceId: openingReferenceId, isActive: true },
    select: {
      id: true,
      referenceId: true,
      name: true,
      eco: true,
      fen: true,
      pgn: true,
      moveCount: true,
    },
  });

  return opening;
}

/**
 * Returns the default starting FEN position
 */
export function getDefaultFen(): string {
  return DEFAULT_FEN;
}
