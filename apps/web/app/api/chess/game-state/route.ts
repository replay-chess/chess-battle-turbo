import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireInternalRequest } from "@/lib/auth/resolve-user";
import { errorResponse, requestIdOf, validationErrorResponse } from "@/lib/auth/error-response";
import { logger } from "@/lib/logger";

// Socket server only (plan §3.2 H2, A12): clock flushes without a move. Browsers get 401/403.

// Bounded so a slow database never holds the socket's 8 s attempt open (H6 #9).
export const maxDuration = 10;

const gameStateSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  whiteTime: z.number().int().min(0),
  blackTime: z.number().int().min(0),
  lastMoveAt: z.string().datetime().or(z.date()),
});

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
    const validatedData = gameStateSchema.parse(body);

    logger.info("POST /api/chess/game-state", { game: validatedData.gameReferenceId });

    // Conditional write: only a game that is still in progress takes new clocks.
    const written = await prisma.game.updateMany({
      where: { referenceId: validatedData.gameReferenceId, status: "IN_PROGRESS" },
      data: {
        creatorTimeRemaining: validatedData.whiteTime,
        opponentTimeRemaining: validatedData.blackTime,
        lastMoveAt: new Date(validatedData.lastMoveAt),
        updatedAt: new Date(),
      },
    });

    if (written.count === 0) {
      const exists = await prisma.game.findUnique({
        where: { referenceId: validatedData.gameReferenceId },
        select: { id: true },
      });
      return exists
        ? errorResponse("conflict", "The game is no longer in progress.", { requestId })
        : errorResponse("not_found", "Game not found.", { requestId });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Game state updated successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationErrorResponse(error.issues, requestId);
    }

    logger.error("POST /api/chess/game-state failed", error);
    return errorResponse("internal", "Something went wrong", { requestId });
  }
}
