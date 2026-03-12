import { prisma } from '../prisma';

/**
 * Fetches a random active chess position from the database
 * @returns A random chess position or null if none found
 */
export async function getRandomChessPosition() {
  const count = await prisma.chessPosition.count({
    where: {
      isActive: true,
    },
  });

  if (count === 0) {
    return null;
  }

  // Generate a random skip value
  const skip = Math.floor(Math.random() * count);

  const position = await prisma.chessPosition.findFirst({
    where: {
      isActive: true,
    },
    skip,
    select: {
      id: true,
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      tournamentName: true,
      positionType: true,
      sourceType: true,
      whiteLegend: {
        select: { profilePhotoUrl: true },
      },
      blackLegend: {
        select: { profilePhotoUrl: true },
      },
    },
  });

  return position;
}

/**
 * Increments the timesPlayed counter for a chess position
 * @param positionId - The ID of the chess position
 */
/**
 * Fetches a chess position by its referenceId
 * @param referenceId - The CUID referenceId
 * @returns The chess position or null if not found
 */
export async function getPositionByReferenceId(referenceId: string) {
  return prisma.chessPosition.findUnique({
    where: { referenceId },
    select: {
      id: true,
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      tournamentName: true,
      positionType: true,
      sourceType: true,
      whiteLegend: {
        select: { profilePhotoUrl: true },
      },
      blackLegend: {
        select: { profilePhotoUrl: true },
      },
    },
  });
}

export async function incrementPositionPlayCount(positionId: bigint) {
  await prisma.chessPosition.update({
    where: { id: positionId },
    data: {
      timesPlayed: {
        increment: 1,
      },
    },
  });
}

/**
 * Fetches a random chess position from a specific legend's games
 * @param legendReferenceId - The legend's referenceId (cuid)
 * @returns A random chess position from that legend's games or null if none found
 */
export async function getRandomPositionByLegend(legendReferenceId: string) {
  // Find the legend by referenceId
  const legend = await prisma.legend.findUnique({
    where: { referenceId: legendReferenceId },
  });

  if (!legend) {
    console.warn(`Legend not found with referenceId: ${legendReferenceId}`);
    return null;
  }

  // Count positions where this legend played (as white or black)
  const count = await prisma.chessPosition.count({
    where: {
      isActive: true,
      OR: [
        { whitePlayerId: legend.id },
        { blackPlayerId: legend.id },
      ],
    },
  });

  if (count === 0) {
    console.warn(`No positions found for legend: ${legend.name}`);
    return null;
  }

  // Generate a random skip value
  const skip = Math.floor(Math.random() * count);

  const position = await prisma.chessPosition.findFirst({
    where: {
      isActive: true,
      OR: [
        { whitePlayerId: legend.id },
        { blackPlayerId: legend.id },
      ],
    },
    skip,
    select: {
      id: true,
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      whitePlayerId: true,
      blackPlayerId: true,
      tournamentName: true,
      positionType: true,
      sourceType: true,
      whiteLegend: {
        select: { profilePhotoUrl: true },
      },
      blackLegend: {
        select: { profilePhotoUrl: true },
      },
    },
  });

  return position ? { ...position, legendId: legend.id } : null;
}
