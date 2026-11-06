// POST /api/chess/join (legacy friend join, kept until P9; phase-02 plan §6.6.2, §7.2). The join is ONE conditional
// statement (`joinLiveGame`): `status = 'WAITING_FOR_OPPONENT' AND "opponentId" IS NULL AND "creatorId" <> me`, it fills
// the empty colour and its display snapshot, inserts the joiner's game_players row and completes the creator's. Two
// concurrent joiners: exactly one wins; the other gets 409 conflict {reason: already_started} (play-a B13). The
// legacy "not available" / "expired" / "own game" answers and the response shape are unchanged.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { joinLiveGame, timeClassOf } from "@repo/db/games";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";
import { requireSubscribedUser } from "@/lib/auth/require-subscription";
import { ratingFor } from "@/lib/games/start.server";
import { rawDb } from "@/lib/games/snapshot.server";
import { logger } from "@/lib/logger";
import { trackUserAction } from "@/lib/metrics";

const joinGameSchema = z.object({
  gameReferenceId: z.string().min(1, "Game reference ID is required"),
});

const PLAYER_SELECT = { referenceId: true, name: true, profilePictureUrl: true, code: true } as const;

async function validateAndFetchGame(gameReferenceId: string) {
  const game = await prisma.game.findUnique({
    where: { referenceId: gameReferenceId },
    select: {
      id: true,
      referenceId: true,
      status: true,
      creatorId: true,
      expiresAt: true,
      gameData: true,
      initialTimeSeconds: true,
      incrementSeconds: true,
    },
  });

  if (!game) {
    throw new ValidationError("Game not found", 404);
  }

  if (game.status !== "WAITING_FOR_OPPONENT") {
    throw new ValidationError(
      `This game is not available to join. Current status: ${game.status}`,
      400,
      { currentStatus: game.status }
    );
  }

  const now = new Date();
  if (game.expiresAt < now) {
    throw new ValidationError(
      "This game invitation has expired",
      400,
      { expiresAt: game.expiresAt }
    );
  }

  return game;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user via Clerk session and require an active Player plan
    const gate = await requireSubscribedUser(request);
    if (gate.response) return gate.response;
    const opponent = gate.user;

    // 2. Parse and validate request body
    const body = await request.json();
    const validatedData = joinGameSchema.parse(body);
    logger.info(`Join game request: game=${validatedData.gameReferenceId}`);

    // 3. Fetch and validate game
    const game = await validateAndFetchGame(validatedData.gameReferenceId);

    // 3b. Continue the game's distributed trace if trace context is available
    const traceContext = (game.gameData as { traceContext?: { sentryTrace?: string; baggage?: string } } | null)?.traceContext;
    Sentry.setTag("game.referenceId", game.referenceId);

    trackUserAction("join_game");

    const executeJoin = async () => {
      // 4. Prevent self-play
      if (game.creatorId === opponent.id) {
        throw new ValidationError("You cannot join your own game", 400);
      }

      // 5. Conditional join: fills the empty colour, the display snapshot and both game_players rows
      const profile = await prisma.chessComProfile.findUnique({
        where: { userId: opponent.id },
        select: { bulletRating: true, blitzRating: true, rapidRating: true },
      });
      const timeClass = timeClassOf({ initialSeconds: game.initialTimeSeconds, incrementSeconds: game.incrementSeconds });
      const joined = await joinLiveGame(rawDb(prisma), {
        ref: game.referenceId,
        me: { userId: opponent.id, name: opponent.name, rating: ratingFor(profile, timeClass) },
      });
      if (!joined) {
        return NextResponse.json(
          { error: "This game has already started.", code: "conflict", details: { reason: "already_started" } },
          { status: 409 }
        );
      }

      const updatedGame = await prisma.game.findUnique({
        where: { id: joined.id },
        select: {
          referenceId: true,
          status: true,
          initialTimeSeconds: true,
          incrementSeconds: true,
          startedAt: true,
          expiresAt: true,
          createdAt: true,
          creator: { select: PLAYER_SELECT },
          opponent: { select: PLAYER_SELECT },
        },
      });
      if (!updatedGame) throw new ValidationError("Game not found", 404);

      // 6. Return success response
      return NextResponse.json(
        {
          success: true,
          message: "Successfully joined the game",
          data: {
            game: {
              referenceId: updatedGame.referenceId,
              status: updatedGame.status,
              initialTimeSeconds: updatedGame.initialTimeSeconds,
              incrementSeconds: updatedGame.incrementSeconds,
              timeControl: {
                format: `${updatedGame.initialTimeSeconds / 60}+${updatedGame.incrementSeconds}`,
              },
              creator: updatedGame.creator,
              opponent: updatedGame.opponent,
              startedAt: updatedGame.startedAt,
              expiresAt: updatedGame.expiresAt,
              createdAt: updatedGame.createdAt,
            },
          },
        },
        { status: 200 }
      );
    };

    // Link to the game's original trace if trace context is available
    if (traceContext?.sentryTrace) {
      return await Sentry.continueTrace(
        {
          sentryTrace: traceContext.sentryTrace,
          baggage: traceContext.baggage || "",
        },
        executeJoin
      );
    }

    return await executeJoin();
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        },
        { status: 400 }
      );
    }

    // Handle custom validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details && { details: error.details }),
        },
        { status: error.statusCode }
      );
    }

    // Handle unexpected errors
    logger.error("Error joining game", error);
    return NextResponse.json(
      {
        error: "Failed to join game",
      },
      { status: 500 }
    );
  }
}
