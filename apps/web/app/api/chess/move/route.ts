import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { requireInternalRequest } from "@/lib/auth/resolve-user";
import { errorResponse, requestIdOf, validationErrorResponse } from "@/lib/auth/error-response";
import { logger } from "@/lib/logger";
import { trackUserAction } from "@/lib/metrics";

// Socket server only (plan §3.2 H2, A12): the socket validates every move with chess.js and
// persists the resulting position here. Browsers get 401/403.

// Bounded so a slow database never holds the socket's 8 s attempt open (H6 #9).
export const maxDuration = 10;

const moveSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
  from: z.string().min(2).max(2),
  to: z.string().min(2).max(2),
  promotion: z.string().optional(),
  fen: z.string().min(1, "FEN is required"),
  moveHistory: z.array(z.any()),
  whiteTime: z.number().int().min(0),
  blackTime: z.number().int().min(0),
});

/** Compare-and-set attempts when another write lands between our read and our update. */
const MAX_WRITE_ATTEMPTS = 3;

function storedHistoryLength(gameData: unknown): number {
  if (!gameData || typeof gameData !== "object") return 0;
  const history = (gameData as { moveHistory?: unknown }).moveHistory;
  return Array.isArray(history) ? history.length : 0;
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
    const validatedData = moveSchema.parse(body);

    Sentry.setTag("game.referenceId", validatedData.gameReferenceId);
    trackUserAction("make_move");

    // Compare-and-set on `updatedAt`: two in-flight persists can arrive out of order, and an
    // older (shorter) history must never overwrite a newer one (H6 #12 length guard).
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const game = await prisma.game.findUnique({
        where: { referenceId: validatedData.gameReferenceId },
        select: { status: true, gameData: true, updatedAt: true },
      });

      if (!game) {
        return errorResponse("not_found", "Game not found.", { requestId });
      }
      if (game.status !== "IN_PROGRESS") {
        return errorResponse("conflict", "The game is no longer in progress.", { requestId });
      }
      if (validatedData.moveHistory.length < storedHistoryLength(game.gameData)) {
        return errorResponse("conflict", "A newer move history is already stored.", { requestId });
      }

      const now = new Date();
      const written = await prisma.game.updateMany({
        where: {
          referenceId: validatedData.gameReferenceId,
          status: "IN_PROGRESS",
          updatedAt: game.updatedAt,
        },
        data: {
          gameData: {
            ...(game.gameData as Record<string, unknown> | null),
            fen: validatedData.fen,
            moveHistory: validatedData.moveHistory,
          },
          creatorTimeRemaining: validatedData.whiteTime,
          opponentTimeRemaining: validatedData.blackTime,
          lastMoveAt: now,
          updatedAt: now,
        },
      });

      if (written.count === 1) {
        return NextResponse.json(
          {
            success: true,
            data: {
              game: {
                referenceId: validatedData.gameReferenceId,
                status: "IN_PROGRESS",
                updatedAt: now,
              },
            },
          },
          { status: 200 },
        );
      }
      // Lost the race: re-read and re-check the guards.
    }

    return errorResponse("conflict", "The game changed while saving the move.", { requestId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationErrorResponse(error.issues, requestId);
    }

    logger.error("Error persisting move", error);
    return errorResponse("internal", "Something went wrong", { requestId });
  }
}
