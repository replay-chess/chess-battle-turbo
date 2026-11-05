import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { logger } from "@/lib/logger";
import { tokenMatchesSecret } from "@/lib/auth/secrets";

// Who sees what (plan §3.2 H4, A13, AA F-04):
// - a participant (creator or opponent) or the socket server with a valid `x-internal-token`
//   → the full body, as before;
// - everyone else, signed out included → the invite projection: same top-level fields,
//   `gameData` cut to INVITE_GAME_DATA_KEYS, clocks null. No `moveHistory`, `traceContext`,
//   `fen` or `playerReferenceId`.

/**
 * `gameData` keys an invitee may see. The plan's list is `creatorColor`, `isAIGame`,
 * `difficulty`; `gameMode` and `positionInfo` are added because the join page shows them
 * before the invitee joins (`app/(app)/join/[gameReferenceId]/page.tsx`). Both are catalogue
 * content (legend or opening position), not game state.
 */
const INVITE_GAME_DATA_KEYS = [
  "creatorColor",
  "isAIGame",
  "difficulty",
  "gameMode",
  "positionInfo",
] as const;

function inviteGameData(gameData: unknown): Record<string, unknown> | undefined {
  if (!gameData || typeof gameData !== "object" || Array.isArray(gameData)) return undefined;
  const source = gameData as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const key of INVITE_GAME_DATA_KEYS) {
    if (key in source) projected[key] = source[key];
  }
  return projected;
}

function isInternalCaller(request: NextRequest): boolean {
  return tokenMatchesSecret(request.headers.get("x-internal-token"), process.env.INTERNAL_API_SECRET);
}

async function viewerReferenceId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const viewer = await prisma.user.findUnique({
    where: { googleId: userId },
    select: { referenceId: true },
  });
  return viewer?.referenceId ?? null;
}

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameReferenceId: string }> }
) {
  try {
    const { gameReferenceId } = await params;

    if (!gameReferenceId) {
      return NextResponse.json(
        {
          success: false,
          error: "Game reference ID is required"
        },
        { status: 400, headers: PRIVATE_NO_STORE }
      );
    }

    const internal = isInternalCaller(request);
    const [game, viewerRef] = await Promise.all([
      prisma.game.findUnique({
        where: { referenceId: gameReferenceId },
        select: {
          referenceId: true,
          chessPositionId: true,
          startingFen: true,
          status: true,
          initialTimeSeconds: true,
          incrementSeconds: true,
          creatorTimeRemaining: true,
          opponentTimeRemaining: true,
          gameData: true,
          creator: {
            select: {
              referenceId: true,
              name: true,
              code: true,
              profilePictureUrl: true,
            },
          },
          opponent: {
            select: {
              referenceId: true,
              name: true,
              code: true,
              profilePictureUrl: true,
            },
          },
        },
      }),
      internal ? Promise.resolve(null) : viewerReferenceId(),
    ]);

    if (!game) {
      return NextResponse.json(
        {
          success: false,
          error: "Game not found"
        },
        { status: 404, headers: PRIVATE_NO_STORE }
      );
    }

    const isParticipant =
      viewerRef !== null &&
      (game.creator.referenceId === viewerRef || game.opponent?.referenceId === viewerRef);
    const full = internal || isParticipant;

    // Transform to match GameData interface
    const response = {
      success: true,
      data: {
        referenceId: game.referenceId,
        creatorId: game.creator.referenceId,
        opponentId: game.opponent?.referenceId ?? null,
        chessPositionId: game.chessPositionId?.toString() ?? null,
        startingFen: game.startingFen,
        initialTimeSeconds: game.initialTimeSeconds,
        incrementSeconds: game.incrementSeconds,
        creatorTimeRemaining: full ? game.creatorTimeRemaining : null,
        opponentTimeRemaining: full ? game.opponentTimeRemaining : null,
        status: game.status,
        gameData: full
          ? (game.gameData as Record<string, unknown> | undefined)
          : inviteGameData(game.gameData),
        creator: {
          userReferenceId: game.creator.referenceId,
          name: game.creator.name,
          code: game.creator.code,
          profilePictureUrl: game.creator.profilePictureUrl,
        },
        ...(game.opponent && {
          opponent: {
            userReferenceId: game.opponent.referenceId,
            name: game.opponent.name,
            code: game.opponent.code,
            profilePictureUrl: game.opponent.profilePictureUrl,
          },
        }),
      },
    };

    return NextResponse.json(response, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    logger.error("GET /api/chess/game-by-ref failed", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error"
      },
      { status: 500, headers: PRIVATE_NO_STORE }
    );
  }
}
