import "server-only";

import { prisma } from "@/lib/prisma";
import type { FeaturedPosition } from "@/lib/featured-position-types";

export async function getFeaturedPositions(): Promise<FeaturedPosition[]> {
  if (!process.env.DATABASE_URL) return [];

  const positions = await prisma.chessPosition.findMany({
    where: {
      featured: true,
      isActive: true,
    },
    take: 6,
    orderBy: { createdAt: "desc" },
    select: {
      referenceId: true,
      fen: true,
      sideToMove: true,
      whitePlayerName: true,
      blackPlayerName: true,
      tournamentName: true,
      positionType: true,
      positionContext: true,
    },
  });

  return positions.map((position) => ({
    ...position,
    positionContext: position.positionContext as Record<string, unknown> | null,
  }));
}
