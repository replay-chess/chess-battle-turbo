import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * POST /api/user/sync
 * Creates or updates a user in the database based on their Clerk authentication data
 */
export async function POST(req: NextRequest) {
  try {
    // Get the authenticated user's ID from Clerk
    const { userId } = await auth();

    logger.info(`POST /api/user/sync - clerkUserId ${userId}`);

    // Check if user is authenticated
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized - User not authenticated" },
        { status: 401 }
      );
    }

    // Get the full user object from Clerk
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);

    if (!clerkUser) {
      return NextResponse.json(
        { error: "User not found in Clerk" },
        { status: 404 }
      );
    }

    // Extract user data from Clerk
    const email = clerkUser.emailAddresses[0]?.emailAddress;
    const name =
      clerkUser.fullName ||
      `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() ||
      "Anonymous User";
    const profilePictureUrl = clerkUser.imageUrl;

    if (!email) {
      return NextResponse.json(
        { error: "User email not found" },
        { status: 400 }
      );
    }

    // Generate a unique user code (6 characters, alphanumeric)
    const generateUserCode = () => {
      return Math.random().toString(36).substring(2, 8).toUpperCase();
    };

    // Check by googleId first (returning user), then by email (link existing account)
    const existingUser =
      (await prisma.user.findUnique({
        where: { googleId: userId },
        include: { stats: true, chessComProfile: true },
      })) ??
      (await prisma.user.findUnique({
        where: { email },
        include: { stats: true, chessComProfile: true },
      }));

    let user;

    if (existingUser) {
      // Update existing user (also links googleId for email-matched users)
      user = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          email,
          name,
          profilePictureUrl,
          updatedAt: new Date(),
          googleId: userId,
        },
        include: {
          stats: true,
          chessComProfile: true,
        },
      });
    } else {
      // Create new user with stats in a transaction
      let userCode = generateUserCode();
      let isUnique = false;

      // Ensure user code is unique
      while (!isUnique) {
        const existingCode = await prisma.user.findUnique({
          where: { code: userCode },
        });
        if (!existingCode) {
          isUnique = true;
        } else {
          userCode = generateUserCode();
        }
      }

      try {
        user = await prisma.$transaction(async (tx) => {
          // Create user (onboarded: false — will be set true after onboarding or skip)
          const newUser = await tx.user.create({
            data: {
              googleId: userId,
              email,
              name,
              code: userCode,
              profilePictureUrl,
              isActive: true,
              onboarded: false,
            },
          });

          // Create stats for user
          await tx.userStats.create({
            data: {
              userId: newUser.id,
              totalGamesPlayed: 0,
              gamesWon: 0,
              gamesLost: 0,
              gamesDrawn: 0,
              currentWinStreak: 0,
              longestWinStreak: 0,
            },
          });

          // Fetch the complete user with relations
          return await tx.user.findUnique({
            where: { id: newUser.id },
            include: {
              stats: true,
              chessComProfile: true,
            },
          });
        });
      } catch (txError: any) {
        // Race condition: another parallel request created the user between our check and insert
        if (txError.code === "P2002") {
          user = await prisma.user.findUnique({
            where: { googleId: userId },
            include: {
              stats: true,
              chessComProfile: true,
            },
          });
        } else {
          throw txError;
        }
      }
    }

    // Convert BigInt and Decimal values to strings for JSON serialization
    // Note: We only send referenceIds to the client, never internal database IDs
    const userResponse = {
      referenceId: user?.referenceId,
      onboarded: user?.onboarded,
      code: user?.code,
      email: user?.email,
      name: user?.name,
      profilePictureUrl: user?.profilePictureUrl,
      role: user?.role ?? "USER",
      clerkUserId: userId,
      stats: user?.stats ? {
        referenceId: user.stats.referenceId,
        totalGamesPlayed: user.stats.totalGamesPlayed,
        gamesWon: user.stats.gamesWon,
        gamesLost: user.stats.gamesLost,
        gamesDrawn: user.stats.gamesDrawn,
        currentWinStreak: user.stats.currentWinStreak,
        longestWinStreak: user.stats.longestWinStreak,
        averageGameDuration: user.stats.averageGameDuration,
        lastPlayedAt: user.stats.lastPlayedAt?.toISOString() || null,
      } : null,
      chessComProfile: user?.chessComProfile ? {
        referenceId: user.chessComProfile.referenceId,
        chessComHandle: user.chessComProfile.chessComHandle,
        rapidRating: user.chessComProfile.rapidRating,
        blitzRating: user.chessComProfile.blitzRating,
      } : null,
    };

    logger.info(`User synced: ${user?.referenceId}, ${existingUser ? "updated" : "created"}`);

    return NextResponse.json(
      {
        success: true,
        message: existingUser ? "User updated successfully" : "User created successfully",
        user: userResponse,
      },
      { status: existingUser ? 200 : 201 }
    );
  } catch (error) {
    logger.error(`POST /api/user/sync failed: ${error instanceof Error ? error.message : "Unknown error"}`, error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

