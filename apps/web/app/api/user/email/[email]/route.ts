import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// DEPRECATED (plan §3.2 H3, A15, AA F-03). 1B·F4d deletes this route once its two callers
// (`lib/stores/useUserStore.ts` fetchUserByEmail, `lib/hooks/useRequireAuth.ts`) read
// `GET /api/me` instead.
//
// Until then it answers only the signed-in caller about their own row: any other email,
// a signed-out request, a missing row and an inactive row are all the same 404, so the route
// can no longer confirm whether an address has an account. `dateOfBirth` and `role` are no
// longer returned.

const NOT_FOUND = () =>
  NextResponse.json(
    { error: "User not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId || !email) return NOT_FOUND();

    const user = await prisma.user.findUnique({
      where: { googleId: clerkUserId },
      include: {
        stats: true,
      },
    });

    const requested = email.trim().toLowerCase();
    if (!user || !user.isActive || user.email.toLowerCase() !== requested) {
      return NOT_FOUND();
    }

    const winRate = user.stats && user.stats.totalGamesPlayed > 0
      ? ((user.stats.gamesWon / user.stats.totalGamesPlayed) * 100).toFixed(2)
      : "0.00";

    return NextResponse.json(
      {
        success: true,
        data: {
          user: {
            referenceId: user.referenceId,
            code: user.code,
            name: user.name,
            email: user.email,
            profilePictureUrl: user.profilePictureUrl,
            isActive: user.isActive,
            createdAt: user.createdAt,
          },
          stats: user.stats
            ? {
                referenceId: user.stats.referenceId,
                totalGamesPlayed: user.stats.totalGamesPlayed,
                gamesWon: user.stats.gamesWon,
                gamesLost: user.stats.gamesLost,
                gamesDrawn: user.stats.gamesDrawn,
                winRate: `${winRate}%`,
                currentWinStreak: user.stats.currentWinStreak,
                longestWinStreak: user.stats.longestWinStreak,
                averageGameDuration: user.stats.averageGameDuration,
                lastPlayedAt: user.stats.lastPlayedAt,
              }
            : null,
        },
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    logger.error("Error fetching user by email", error);
    return NextResponse.json(
      {
        error: "Failed to fetch user details",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
