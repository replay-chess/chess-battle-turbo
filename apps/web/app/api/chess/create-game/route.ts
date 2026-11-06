// POST /api/chess/create-game (legacy friend challenge, kept until P9's /api/challenges; phase-02 plan §6.6.2, §7.2).
// Writes the P2 play columns through `createLiveGame` (mode FRIEND, the creator's colour column and display snapshot,
// studySeconds, timeClass, startPly, fen, phase WAITING, meta, the creator's game_players row) in one statement, and
// keeps `gameData` (creatorColor, positionInfo, …) for the legacy readers (v1 socket, game-by-ref, analysis) until the
// parity gate. An optional `Idempotency-Key` stops double-click duplicates (audit-api F-06). The response shape is
// unchanged (tolerant readers).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { createLiveGameSql } from "@repo/db/games";
import { prisma } from "@/lib/prisma";
import { ApiError, isApiError } from "@/lib/api/api-error";
import { readIdempotencyKey, requestHash, withIdempotency } from "@/lib/api/idempotency";
import { ValidationError } from "@/lib/errors/validation-error";
import { requireSubscribedUser } from "@/lib/auth/require-subscription";
import { captureGameTraceData } from "@/lib/sentry/game-trace";
import { legacyPositionInfo, ratingFor, resolveLegacyStart, type Side } from "@/lib/games/start.server";
import { rawDb } from "@/lib/games/snapshot.server";
import { timeClassOf } from "@repo/db/games";
import { logger } from "@/lib/logger";
import { trackUserAction } from "@/lib/metrics";

const createGameSchema = z.object({
  userReferenceId: z.string().min(1, "User reference ID is required"),
  initialTimeSeconds: z.number().int().positive("Initial time must be greater than 0"),
  incrementSeconds: z.number().int().min(0, "Increment seconds must be 0 or greater"),
  gameMode: z.enum(["quick", "friend", "ai"]),
  playAsLegend: z.boolean(),
  selectedLegend: z.string().nullable(),
  selectedOpening: z.string().nullable().optional(),
  chessPositionReferenceId: z.string().optional(),
});

const INVITE_TTL_MS = 60 * 60 * 1000;

function legacyError(err: ApiError): NextResponse {
  return NextResponse.json(
    { error: err.message, code: err.code, ...(err.details ? { details: err.details } : {}), ...(err.fields ? { fields: err.fields } : {}) },
    { status: err.status, headers: err.retryAfterSec ? { "Retry-After": String(err.retryAfterSec) } : undefined },
  );
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate user via Clerk session and require an active Player plan
    const gate = await requireSubscribedUser(request);
    if (gate.response) return gate.response;
    const user = gate.user;

    // 2. Parse and validate request body using Zod schema
    const body = await request.json();
    const validatedData = createGameSchema.parse(body);
    const key = readIdempotencyKey(request.headers, { required: false });

    const create = async () => {
      // 3. Start: position by ref, opening, legend position, else a random position (unknown refs are tolerated)
      const [start, profile] = await Promise.all([
        resolveLegacyStart(prisma, {
          positionRef: validatedData.chessPositionReferenceId ?? null,
          openingRef: validatedData.chessPositionReferenceId ? null : (validatedData.selectedOpening ?? null),
          legendRef:
            validatedData.chessPositionReferenceId || validatedData.selectedOpening
              ? null
              : validatedData.playAsLegend
                ? validatedData.selectedLegend
                : null,
        }),
        prisma.chessComProfile.findUnique({
          where: { userId: user.id },
          select: { bulletRating: true, blitzRating: true, rapidRating: true },
        }),
      ]);

      // 4. Colours are fixed here, once (H6 #11, plan §8.8): the position's side to move, the opening's side, the
      // legend's side, else random. The v1 socket reads gameData.creatorColor; v2 reads whitePlayerId/blackPlayerId.
      const creatorSide: Side = start.ruledSide ?? (Math.random() < 0.5 ? "w" : "b");
      const extraGameData: Record<string, unknown> = { creatorColor: creatorSide === "w" ? "white" : "black" };
      const traceData = captureGameTraceData();
      if (traceData) extraGameData.traceContext = traceData;
      if (start.opening) {
        extraGameData.selectedOpening = validatedData.selectedOpening;
        extraGameData.openingInfo = {
          referenceId: start.opening.referenceId,
          name: start.opening.name,
          eco: start.opening.eco,
          pgn: start.opening.pgn,
          moveCount: start.opening.moveCount,
        };
      }

      // 5. Create the game (+ the creator's game_players row) and count the position's play, atomically
      const now = new Date();
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      const timeClass = timeClassOf({ initialSeconds: validatedData.initialTimeSeconds, incrementSeconds: validatedData.incrementSeconds });
      const me = { userId: user.id, name: user.name, rating: ratingFor(profile, timeClass) };
      const { sql, ref } = createLiveGameSql({
        mode: "FRIEND",
        creatorId: user.id,
        opponentId: null,
        white: creatorSide === "w" ? me : null,
        black: creatorSide === "b" ? me : null,
        startingFen: start.fen,
        initialTimeSeconds: validatedData.initialTimeSeconds,
        incrementSeconds: validatedData.incrementSeconds,
        status: "WAITING_FOR_OPPONENT",
        chessPositionId: start.position?.id ?? null,
        openingId: start.opening?.id ?? null,
        meta: start.meta,
        gameData: {
          gameMode: validatedData.gameMode,
          playAsLegend: validatedData.playAsLegend,
          selectedLegend: validatedData.selectedLegend,
          positionInfo: legacyPositionInfo(start.position, start.opening),
          ...extraGameData,
        },
        expiresAt,
        now,
      });
      await prisma.$transaction([
        prisma.$queryRawUnsafe(sql.text, ...sql.values), // (text, ...values): see rawDb()
        ...(start.position
          ? [prisma.chessPosition.update({ where: { id: start.position.id }, data: { timesPlayed: { increment: 1 } } })]
          : []),
      ]);

      Sentry.setTag("game.referenceId", ref);
      trackUserAction("create_game");
      return {
        status: 201,
        body: {
          success: true,
          message: "Game created successfully",
          data: {
            game: {
              referenceId: ref,
              startingFen: start.fen,
              chessPositionId: start.position?.id.toString() ?? null,
              initialTimeSeconds: validatedData.initialTimeSeconds,
              incrementSeconds: validatedData.incrementSeconds,
              status: "WAITING_FOR_OPPONENT",
              expiresAt: expiresAt.toISOString(),
              createdAt: now.toISOString(),
            },
          },
        },
      };
    };

    const out = key
      ? await withIdempotency(
          rawDb(prisma),
          { userId: user.id, key, route: "chess.create-game", hash: requestHash(validatedData), now: new Date() },
          create,
        )
      : { ...(await create()), replayed: false };
    return NextResponse.json(out.body, {
      status: out.status,
      headers: out.replayed ? { "Idempotent-Replayed": "true" } : undefined,
    });
  } catch (error) {
    if (isApiError(error)) return legacyError(error);

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
    logger.error("Error creating game", error);
    return NextResponse.json(
      {
        error: "Failed to create game",
      },
      { status: 500 }
    );
  }
}
