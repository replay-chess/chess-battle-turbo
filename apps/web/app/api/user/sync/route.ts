import { NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { syncClerkClaims } from "@/lib/auth/claims";
import { provisionUser } from "@/lib/auth/provision-user";

/**
 * POST /api/user/sync (plan §7.4 A16; deprecated: no caller after 1B·F4d, delete in P2 after 14 days without traffic)
 *
 * Finds or creates the signed-in user's row and returns it in the Phase 0 shape. The row comes from provisionUser()
 * (plan §8.5): the verified primary email only, relink by verified email, one transaction for users + user_stats.
 * Profile changes (name, picture, email) arrive through the Clerk `user.updated` webhook, not here.
 */
export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized - User not authenticated" }, { status: 401 });
    }

    const result = await provisionUser(userId);
    if (result.status === "unverified_email") {
      return NextResponse.json({ error: "User email not found" }, { status: 400 });
    }
    if (result.status === "clerk_user_missing") {
      return NextResponse.json({ error: "User not found in Clerk" }, { status: 404 });
    }
    if (result.status === "clerk_unavailable") {
      return NextResponse.json({ error: "Authentication service unavailable" }, { status: 502 });
    }

    if (result.created || result.relinked) {
      const createdId = result.userId;
      after(() => syncClerkClaims(createdId));
    }

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      include: { stats: true, chessComProfile: true },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only referenceIds go to the client, never internal database ids.
    const userResponse = {
      referenceId: user.referenceId,
      onboarded: user.onboarded,
      code: user.code,
      email: user.email,
      name: user.name,
      profilePictureUrl: user.profilePictureUrl,
      role: user.role ?? "USER",
      clerkUserId: userId,
      stats: user.stats
        ? {
            referenceId: user.stats.referenceId,
            totalGamesPlayed: user.stats.totalGamesPlayed,
            gamesWon: user.stats.gamesWon,
            gamesLost: user.stats.gamesLost,
            gamesDrawn: user.stats.gamesDrawn,
            currentWinStreak: user.stats.currentWinStreak,
            longestWinStreak: user.stats.longestWinStreak,
            averageGameDuration: user.stats.averageGameDuration,
            lastPlayedAt: user.stats.lastPlayedAt?.toISOString() || null,
          }
        : null,
      chessComProfile: user.chessComProfile
        ? {
            referenceId: user.chessComProfile.referenceId,
            chessComHandle: user.chessComProfile.chessComHandle,
            rapidRating: user.chessComProfile.rapidRating,
            blitzRating: user.chessComProfile.blitzRating,
          }
        : null,
    };

    logger.info(`User synced: ${user.referenceId}, ${result.created ? "created" : "found"}`);

    return NextResponse.json(
      {
        success: true,
        message: result.created ? "User created successfully" : "User updated successfully",
        user: userResponse,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    logger.error("POST /api/user/sync failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
