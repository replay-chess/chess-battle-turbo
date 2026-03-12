import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const DEMO_USER_CODE = "DEMO_PLAYER_001";
const DEMO_USER_EMAIL = "demo@replaychess.local";
const BOT_USER_CODE = "CHESS_BOT_001";
const BOT_USER_EMAIL = "bot@replaychess.local";

// Fixed demo game settings
const DEMO_TIME_SECONDS = 300; // 5 minutes
const DEMO_INCREMENT_SECONDS = 3; // +3 seconds
const DEMO_DIFFICULTY = "medium";

const createDemoGameSchema = z.object({
  chessPositionReferenceId: z.string().min(1, "Position reference ID is required"),
});

// Simple in-memory rate limiter by IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

async function getOrCreateSystemUser(code: string, email: string, name: string) {
  let user = await prisma.user.findUnique({ where: { code } });
  if (user) {
    if (user.email !== email) {
      user = await prisma.user.update({ where: { code }, data: { email } });
    }
    return user;
  }
  user = await prisma.user.create({
    data: {
      code,
      googleId: code === BOT_USER_CODE ? "bot_system_user" : "demo_system_user",
      email,
      name,
      profilePictureUrl: null,
      isActive: true,
      onboarded: true,
      stats: {
        create: {
          totalGamesPlayed: 0,
          gamesWon: 0,
          gamesLost: 0,
          gamesDrawn: 0,
          currentWinStreak: 0,
          longestWinStreak: 0,
        },
      },
    },
  });
  return user;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "unknown";
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many demo games. Please sign up for unlimited access!" },
        { status: 429 }
      );
    }

    // Parse and validate
    const body = await request.json();
    const { chessPositionReferenceId } = createDemoGameSchema.parse(body);

    // Validate position exists and is featured
    const position = await prisma.chessPosition.findFirst({
      where: {
        referenceId: chessPositionReferenceId,
        featured: true,
        isActive: true,
      },
    });

    if (!position) {
      return NextResponse.json(
        { error: "Position not found or not available for demo" },
        { status: 404 }
      );
    }

    // Get or create system users
    const [demoUser, botUser] = await Promise.all([
      getOrCreateSystemUser(DEMO_USER_CODE, DEMO_USER_EMAIL, "Demo Player"),
      getOrCreateSystemUser(BOT_USER_CODE, BOT_USER_EMAIL, "Chess Bot"),
    ]);

    // Player plays as the side to move
    const playerColor = position.sideToMove === "black" ? "black" : "white";
    const isPlayerCreator = playerColor === "white";
    const creatorId = isPlayerCreator ? demoUser.id : botUser.id;
    const opponentId = isPlayerCreator ? botUser.id : demoUser.id;

    const positionInfo = {
      whitePlayerName: position.whitePlayerName ?? null,
      blackPlayerName: position.blackPlayerName ?? null,
      tournamentName: position.tournamentName ?? null,
      whitePlayerImageUrl: null,
      blackPlayerImageUrl: null,
    };

    // Create game
    const game = await prisma.game.create({
      data: {
        creatorId,
        opponentId,
        chessPositionId: position.id,
        startingFen: position.fen,
        initialTimeSeconds: DEMO_TIME_SECONDS,
        incrementSeconds: DEMO_INCREMENT_SECONDS,
        creatorTimeRemaining: DEMO_TIME_SECONDS,
        opponentTimeRemaining: DEMO_TIME_SECONDS,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: "IN_PROGRESS",
        startedAt: new Date(),
        gameData: {
          gameMode: "DEMO",
          difficulty: DEMO_DIFFICULTY,
          playerColor,
          playerReferenceId: demoUser.referenceId,
          botReferenceId: botUser.referenceId,
          botName: "Chess Bot",
          positionInfo,
        },
      },
    });

    logger.info(`Demo game created: ${game.referenceId}, position: ${chessPositionReferenceId}`);

    return NextResponse.json(
      {
        success: true,
        data: {
          gameReferenceId: game.referenceId,
          demoUserReferenceId: demoUser.referenceId,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    logger.error("POST /api/chess/create-demo-game failed:", error);
    return NextResponse.json(
      { error: "Failed to create demo game" },
      { status: 500 }
    );
  }
}
