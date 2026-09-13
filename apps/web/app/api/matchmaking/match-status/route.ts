import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMatchStatus } from "@/lib/services/matchmaking";
import { resolveUser } from "@/lib/auth/resolve-user";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const referenceId = searchParams.get("referenceId");

    logger.info(`GET /api/matchmaking/match-status - referenceId ${referenceId}`);

    if (!referenceId) {
      return NextResponse.json(
        {
          success: false,
          error: "referenceId query parameter is required",
        },
        { status: 400 }
      );
    }

    // Only the owner of the queue entry may poll it. The one exception is an
    // immediate match: createMatchRequest hands the joining player the
    // *opponent's* queue entry reference, so a participant of the matched game
    // is also allowed through.
    const entry = await prisma.matchmakingQueue.findUnique({
      where: { referenceId },
      select: { userId: true, matchedGameRef: true },
    });

    if (!entry) {
      return NextResponse.json(
        { success: false, error: "Queue entry not found" },
        { status: 404 }
      );
    }

    if (entry.userId !== user.id) {
      const participatingGame = entry.matchedGameRef
        ? await prisma.game.findFirst({
            where: {
              referenceId: entry.matchedGameRef,
              OR: [{ creatorId: user.id }, { opponentId: user.id }],
            },
            select: { id: true },
          })
        : null;

      if (!participatingGame) {
        logger.warn(
          `GET /api/matchmaking/match-status - user ${user.referenceId} denied access to queue entry ${referenceId}`
        );
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
      }
    }

    const result = await getMatchStatus(referenceId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Queue entry not found") {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 404 }
        );
      }
    }

    logger.error(`GET /api/matchmaking/match-status failed: ${error instanceof Error ? error.message : "Unknown error"}`, error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to get match status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
